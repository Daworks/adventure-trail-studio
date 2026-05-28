use std::{collections::HashSet, env, net::SocketAddr};

use anyhow::Context;
use axum::{
    extract::{Path, Query, State},
    http::{header, Method, StatusCode},
    response::IntoResponse,
    routing::{get, post, put},
    Json, Router,
};
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use sqlx::{sqlite::SqlitePoolOptions, Pool, Row, Sqlite, Transaction};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[derive(Clone)]
struct AppState {
    db: Pool<Sqlite>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Project {
    id: String,
    title: String,
    created_at: String,
    updated_at: String,
    segments: Vec<RouteSegment>,
    waypoints: Vec<Waypoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RouteSegment {
    id: String,
    name: Option<String>,
    points: Vec<RoutePoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RoutePoint {
    id: String,
    lat: f64,
    lng: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Waypoint {
    id: String,
    #[serde(rename = "type")]
    waypoint_type: String,
    lat: f64,
    lng: f64,
    title: String,
    description: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GpxExportQuery {
    #[serde(rename = "type")]
    export_type: String,
}

#[derive(Debug, Deserialize)]
struct GpxImportPayload {
    xml: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GpxImportResult {
    title: Option<String>,
    segments: Vec<RouteSegment>,
    waypoints: Vec<Waypoint>,
    skipped_points: usize,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "tourmap_api=info,tower_http=info".into()),
        )
        .init();

    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://tourmap.db".into());
    ensure_sqlite_file(&database_url)?;
    let db = sqlite_pool_options(5)
        .connect(&database_url)
        .await
        .with_context(|| format!("failed to connect database: {database_url}"))?;
    migrate(&db).await?;

    let state = AppState { db };
    let cors = CorsLayer::new()
        .allow_origin(tower_http::cors::Any)
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PUT,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([header::CONTENT_TYPE]);

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/api/projects", get(list_projects).put(save_project))
        .route(
            "/api/projects/{id}",
            get(load_project).delete(delete_project),
        )
        .route(
            "/api/projects/{project_id}/segments",
            get(list_route_segments).post(create_route_segment),
        )
        .route(
            "/api/projects/{project_id}/segments/{segment_id}",
            put(update_route_segment).delete(delete_route_segment),
        )
        .route("/api/gpx/export", post(export_gpx))
        .route("/api/gpx/import", post(import_gpx))
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr: SocketAddr = env::var("TOURMAP_API_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:4000".into())
        .parse()
        .context("invalid TOURMAP_API_ADDR")?;
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("tourmap api listening on {addr}");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn list_projects(State(state): State<AppState>) -> Result<Json<Vec<Project>>, AppError> {
    let rows = sqlx::query("SELECT id FROM projects ORDER BY updated_at DESC")
        .fetch_all(&state.db)
        .await?;
    let mut projects = Vec::with_capacity(rows.len());
    for row in rows {
        projects.push(load_project_by_id(&state.db, row.get::<String, _>("id")).await?);
    }
    Ok(Json(projects))
}

async fn load_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Project>, AppError> {
    Ok(Json(load_project_by_id(&state.db, id).await?))
}

async fn save_project(
    State(state): State<AppState>,
    Json(project): Json<Project>,
) -> Result<Json<Project>, AppError> {
    validate_project(&project)?;
    let mut tx = state.db.begin().await?;
    sqlx::query(
        r#"
        INSERT INTO projects (id, title, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(&project.id)
    .bind(&project.title)
    .bind(&project.created_at)
    .bind(&project.updated_at)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM route_points WHERE segment_id IN (SELECT id FROM route_segments WHERE project_id = ?1)")
        .bind(&project.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM route_segments WHERE project_id = ?1")
        .bind(&project.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM waypoints WHERE project_id = ?1")
        .bind(&project.id)
        .execute(&mut *tx)
        .await?;

    for (segment_order, segment) in project.segments.iter().enumerate() {
        sqlx::query(
            "INSERT INTO route_segments (id, project_id, name, sort_order) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(&segment.id)
        .bind(&project.id)
        .bind(segment.name.as_deref().unwrap_or(""))
        .bind(segment_order as i64)
        .execute(&mut *tx)
        .await?;

        for (point_order, point) in segment.points.iter().enumerate() {
            sqlx::query(
                "INSERT INTO route_points (id, segment_id, lat, lng, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            )
            .bind(&point.id)
            .bind(&segment.id)
            .bind(point.lat)
            .bind(point.lng)
            .bind(point_order as i64)
            .execute(&mut *tx)
            .await?;
        }
    }

    for (waypoint_order, waypoint) in project.waypoints.iter().enumerate() {
        sqlx::query(
            "INSERT INTO waypoints (id, project_id, type, lat, lng, title, description, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(&waypoint.id)
        .bind(&project.id)
        .bind(&waypoint.waypoint_type)
        .bind(waypoint.lat)
        .bind(waypoint.lng)
        .bind(&waypoint.title)
        .bind(&waypoint.description)
        .bind(waypoint_order as i64)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(Json(project))
}

async fn delete_project(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    let mut tx = state.db.begin().await?;
    sqlx::query("DELETE FROM route_points WHERE segment_id IN (SELECT id FROM route_segments WHERE project_id = ?1)")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM route_segments WHERE project_id = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM waypoints WHERE project_id = ?1")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM projects WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_route_segments(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
) -> Result<Json<Vec<RouteSegment>>, AppError> {
    ensure_project_exists(&state.db, &project_id).await?;
    Ok(Json(load_route_segments(&state.db, &project_id).await?))
}

async fn create_route_segment(
    State(state): State<AppState>,
    Path(project_id): Path<String>,
    Json(segment): Json<RouteSegment>,
) -> Result<Json<Project>, AppError> {
    validate_route_segment(&segment)?;
    let mut tx = state.db.begin().await?;
    ensure_project_exists_in_tx(&mut tx, &project_id).await?;
    ensure_segment_id_available(&mut tx, &segment.id).await?;
    ensure_route_point_ids_available(&mut tx, &segment.points, None).await?;
    let sort_order = next_segment_sort_order(&mut tx, &project_id).await?;
    insert_route_segment(&mut tx, &project_id, &segment, sort_order).await?;
    touch_project_in_tx(&mut tx, &project_id).await?;
    tx.commit().await?;
    Ok(Json(load_project_by_id(&state.db, project_id).await?))
}

async fn update_route_segment(
    State(state): State<AppState>,
    Path((project_id, segment_id)): Path<(String, String)>,
    Json(segment): Json<RouteSegment>,
) -> Result<Json<Project>, AppError> {
    if segment.id != segment_id {
        return Err(AppError::BadRequest(
            "route segment path id must match payload id".into(),
        ));
    }
    validate_route_segment(&segment)?;
    let mut tx = state.db.begin().await?;
    ensure_project_exists_in_tx(&mut tx, &project_id).await?;
    let sort_order = route_segment_sort_order(&mut tx, &project_id, &segment_id).await?;
    ensure_route_point_ids_available(&mut tx, &segment.points, Some(&segment_id)).await?;
    delete_route_points_in_tx(&mut tx, &segment_id).await?;
    sqlx::query("DELETE FROM route_segments WHERE id = ?1 AND project_id = ?2")
        .bind(&segment_id)
        .bind(&project_id)
        .execute(&mut *tx)
        .await?;
    insert_route_segment(&mut tx, &project_id, &segment, sort_order).await?;
    touch_project_in_tx(&mut tx, &project_id).await?;
    tx.commit().await?;
    Ok(Json(load_project_by_id(&state.db, project_id).await?))
}

async fn delete_route_segment(
    State(state): State<AppState>,
    Path((project_id, segment_id)): Path<(String, String)>,
) -> Result<Json<Project>, AppError> {
    let mut tx = state.db.begin().await?;
    ensure_project_exists_in_tx(&mut tx, &project_id).await?;
    route_segment_sort_order(&mut tx, &project_id, &segment_id).await?;
    let count = sqlx::query("SELECT COUNT(*) AS count FROM route_segments WHERE project_id = ?1")
        .bind(&project_id)
        .fetch_one(&mut *tx)
        .await?
        .get::<i64, _>("count");
    if count <= 1 {
        return Err(AppError::BadRequest(
            "at least one route segment is required".into(),
        ));
    }
    delete_route_points_in_tx(&mut tx, &segment_id).await?;
    sqlx::query("DELETE FROM route_segments WHERE id = ?1 AND project_id = ?2")
        .bind(&segment_id)
        .bind(&project_id)
        .execute(&mut *tx)
        .await?;
    touch_project_in_tx(&mut tx, &project_id).await?;
    tx.commit().await?;
    Ok(Json(load_project_by_id(&state.db, project_id).await?))
}

async fn export_gpx(
    Query(query): Query<GpxExportQuery>,
    Json(project): Json<Project>,
) -> Result<impl IntoResponse, AppError> {
    validate_project(&project)?;
    let export_type = GpxExportType::try_from(query.export_type.as_str())?;
    if !project
        .segments
        .iter()
        .any(|segment| !segment.points.is_empty())
    {
        return Err(AppError::BadRequest(
            "at least one route point is required for GPX export".into(),
        ));
    }
    let xml = project_to_gpx(&project, export_type);
    Ok((
        [(header::CONTENT_TYPE, "application/gpx+xml; charset=utf-8")],
        xml,
    ))
}

async fn import_gpx(
    Json(payload): Json<GpxImportPayload>,
) -> Result<Json<GpxImportResult>, AppError> {
    Ok(Json(gpx_to_project_parts(&payload.xml)?))
}

async fn load_project_by_id(db: &Pool<Sqlite>, id: String) -> Result<Project, AppError> {
    let project_row =
        sqlx::query("SELECT id, title, created_at, updated_at FROM projects WHERE id = ?1")
            .bind(&id)
            .fetch_optional(db)
            .await?
            .ok_or(AppError::NotFound)?;

    let segment_rows = sqlx::query(
        "SELECT id, name FROM route_segments WHERE project_id = ?1 ORDER BY sort_order ASC",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    let mut segments = Vec::with_capacity(segment_rows.len());
    for segment_row in segment_rows {
        let segment_id = segment_row.get::<String, _>("id");
        let point_rows = sqlx::query(
            "SELECT id, lat, lng FROM route_points WHERE segment_id = ?1 ORDER BY sort_order ASC",
        )
        .bind(&segment_id)
        .fetch_all(db)
        .await?;
        segments.push(RouteSegment {
            id: segment_id,
            name: Some(segment_row.get::<String, _>("name")),
            points: point_rows
                .into_iter()
                .map(|row| RoutePoint {
                    id: row.get("id"),
                    lat: row.get("lat"),
                    lng: row.get("lng"),
                })
                .collect(),
        });
    }

    let waypoint_rows = sqlx::query(
        "SELECT id, type, lat, lng, title, description FROM waypoints WHERE project_id = ?1 ORDER BY sort_order ASC, title ASC",
    )
    .bind(&id)
    .fetch_all(db)
    .await?;

    Ok(Project {
        id: project_row.get("id"),
        title: project_row.get("title"),
        created_at: project_row.get("created_at"),
        updated_at: project_row.get("updated_at"),
        segments,
        waypoints: waypoint_rows
            .into_iter()
            .map(|row| Waypoint {
                id: row.get("id"),
                waypoint_type: row.get("type"),
                lat: row.get("lat"),
                lng: row.get("lng"),
                title: row.get("title"),
                description: row.get("description"),
            })
            .collect(),
    })
}

async fn load_route_segments(
    db: &Pool<Sqlite>,
    project_id: &str,
) -> Result<Vec<RouteSegment>, AppError> {
    let segment_rows = sqlx::query(
        "SELECT id, name FROM route_segments WHERE project_id = ?1 ORDER BY sort_order ASC",
    )
    .bind(project_id)
    .fetch_all(db)
    .await?;

    let mut segments = Vec::with_capacity(segment_rows.len());
    for segment_row in segment_rows {
        let segment_id = segment_row.get::<String, _>("id");
        let point_rows = sqlx::query(
            "SELECT id, lat, lng FROM route_points WHERE segment_id = ?1 ORDER BY sort_order ASC",
        )
        .bind(&segment_id)
        .fetch_all(db)
        .await?;
        segments.push(RouteSegment {
            id: segment_id,
            name: Some(segment_row.get::<String, _>("name")),
            points: point_rows
                .into_iter()
                .map(|row| RoutePoint {
                    id: row.get("id"),
                    lat: row.get("lat"),
                    lng: row.get("lng"),
                })
                .collect(),
        });
    }
    Ok(segments)
}

async fn ensure_project_exists(db: &Pool<Sqlite>, project_id: &str) -> Result<(), AppError> {
    let exists = sqlx::query("SELECT 1 FROM projects WHERE id = ?1")
        .bind(project_id)
        .fetch_optional(db)
        .await?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

async fn ensure_project_exists_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
) -> Result<(), AppError> {
    let exists = sqlx::query("SELECT 1 FROM projects WHERE id = ?1")
        .bind(project_id)
        .fetch_optional(&mut **tx)
        .await?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

async fn ensure_segment_id_available(
    tx: &mut Transaction<'_, Sqlite>,
    segment_id: &str,
) -> Result<(), AppError> {
    let exists = sqlx::query("SELECT 1 FROM route_segments WHERE id = ?1")
        .bind(segment_id)
        .fetch_optional(&mut **tx)
        .await?
        .is_some();
    if exists {
        Err(AppError::BadRequest(
            "route segment id must be unique".into(),
        ))
    } else {
        Ok(())
    }
}

async fn ensure_route_point_ids_available(
    tx: &mut Transaction<'_, Sqlite>,
    points: &[RoutePoint],
    excluded_segment_id: Option<&str>,
) -> Result<(), AppError> {
    for point in points {
        let row = sqlx::query("SELECT segment_id FROM route_points WHERE id = ?1")
            .bind(&point.id)
            .fetch_optional(&mut **tx)
            .await?;
        let Some(row) = row else {
            continue;
        };
        let segment_id = row.get::<String, _>("segment_id");
        if excluded_segment_id != Some(segment_id.as_str()) {
            return Err(AppError::BadRequest("route point id must be unique".into()));
        }
    }
    Ok(())
}

async fn next_segment_sort_order(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
) -> Result<i64, AppError> {
    let max_order = sqlx::query(
        "SELECT COALESCE(MAX(sort_order), -1) AS max_order FROM route_segments WHERE project_id = ?1",
    )
    .bind(project_id)
    .fetch_one(&mut **tx)
    .await?
    .get::<i64, _>("max_order");
    Ok(max_order + 1)
}

async fn route_segment_sort_order(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    segment_id: &str,
) -> Result<i64, AppError> {
    sqlx::query("SELECT sort_order FROM route_segments WHERE id = ?1 AND project_id = ?2")
        .bind(segment_id)
        .bind(project_id)
        .fetch_optional(&mut **tx)
        .await?
        .map(|row| row.get::<i64, _>("sort_order"))
        .ok_or(AppError::NotFound)
}

async fn insert_route_segment(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
    segment: &RouteSegment,
    sort_order: i64,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO route_segments (id, project_id, name, sort_order) VALUES (?1, ?2, ?3, ?4)",
    )
    .bind(&segment.id)
    .bind(project_id)
    .bind(segment.name.as_deref().unwrap_or(""))
    .bind(sort_order)
    .execute(&mut **tx)
    .await?;

    for (point_order, point) in segment.points.iter().enumerate() {
        sqlx::query(
            "INSERT INTO route_points (id, segment_id, lat, lng, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
        )
        .bind(&point.id)
        .bind(&segment.id)
        .bind(point.lat)
        .bind(point.lng)
        .bind(point_order as i64)
        .execute(&mut **tx)
        .await?;
    }
    Ok(())
}

async fn delete_route_points_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    segment_id: &str,
) -> Result<(), AppError> {
    sqlx::query("DELETE FROM route_points WHERE segment_id = ?1")
        .bind(segment_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

async fn touch_project_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
    )
    .bind(project_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GpxExportType {
    Track,
    Route,
}

impl TryFrom<&str> for GpxExportType {
    type Error = AppError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "track" => Ok(Self::Track),
            "route" => Ok(Self::Route),
            _ => Err(AppError::BadRequest(
                "GPX export type must be track or route".into(),
            )),
        }
    }
}

fn project_to_gpx(project: &Project, export_type: GpxExportType) -> String {
    let waypoint_xml = project
        .waypoints
        .iter()
        .map(waypoint_to_gpx)
        .collect::<Vec<_>>()
        .join("");
    let route_xml = match export_type {
        GpxExportType::Track => {
            let segments = project
                .segments
                .iter()
                .map(|segment| {
                    let points = segment
                        .points
                        .iter()
                        .map(|point| {
                            format!("<trkpt lat=\"{}\" lon=\"{}\" />", point.lat, point.lng)
                        })
                        .collect::<Vec<_>>()
                        .join("");
                    format!("<trkseg>{points}</trkseg>")
                })
                .collect::<Vec<_>>()
                .join("");
            format!(
                "<trk><name>{}</name>{segments}</trk>",
                escape_xml(&project.title)
            )
        }
        GpxExportType::Route => project
            .segments
            .iter()
            .map(|segment| {
                let points = segment
                    .points
                    .iter()
                    .map(|point| format!("<rtept lat=\"{}\" lon=\"{}\" />", point.lat, point.lng))
                    .collect::<Vec<_>>()
                    .join("");
                let name = segment.name.as_deref().unwrap_or("");
                format!("<rte><name>{}</name>{points}</rte>", escape_xml(name))
            })
            .collect::<Vec<_>>()
            .join(""),
    };

    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"TourMap Editor\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n  <metadata>\n    <name>{}</name>\n    <time>{}</time>\n  </metadata>\n  {waypoint_xml}\n  {route_xml}\n</gpx>",
        escape_xml(&project.title),
        escape_xml(&project.updated_at),
    )
}

fn waypoint_to_gpx(waypoint: &Waypoint) -> String {
    format!(
        "<wpt lat=\"{}\" lon=\"{}\"><name>{}</name><desc>{}</desc><type>{}</type></wpt>",
        waypoint.lat,
        waypoint.lng,
        escape_xml(&waypoint.title),
        escape_xml(waypoint.description.as_deref().unwrap_or("")),
        escape_xml(&waypoint.waypoint_type),
    )
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[derive(Debug, Default)]
struct PendingWaypoint {
    lat: f64,
    lng: f64,
    title: String,
    description: Option<String>,
    waypoint_type: Option<String>,
    symbol: Option<String>,
}

fn gpx_to_project_parts(xml: &str) -> Result<GpxImportResult, AppError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);

    let mut path: Vec<String> = Vec::new();
    let mut title: Option<String> = None;
    let mut segments = Vec::new();
    let mut waypoints = Vec::new();
    let mut skipped_points = 0usize;
    let mut track_count = 0usize;
    let mut route_count = 0usize;
    let mut point_count = 0usize;
    let mut waypoint_count = 0usize;

    let mut current_track_name: Option<String> = None;
    let mut current_track_segment_points: Option<Vec<RoutePoint>> = None;
    let mut current_track_segment_index = 0usize;
    let mut current_route_name: Option<String> = None;
    let mut current_route_points: Option<Vec<RoutePoint>> = None;
    let mut current_waypoint: Option<PendingWaypoint> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = event_name(event.name().as_ref());
                match name.as_str() {
                    "trk" => {
                        track_count += 1;
                        current_track_name = None;
                        current_track_segment_index = 0;
                    }
                    "trkseg" => {
                        current_track_segment_points = Some(Vec::new());
                    }
                    "trkpt" => match point_from_attributes(&event, &mut point_count) {
                        Some(point) => {
                            if let Some(points) = current_track_segment_points.as_mut() {
                                points.push(point);
                            }
                        }
                        None => skipped_points += 1,
                    },
                    "rte" => {
                        route_count += 1;
                        current_route_name = None;
                        current_route_points = Some(Vec::new());
                    }
                    "rtept" => match point_from_attributes(&event, &mut point_count) {
                        Some(point) => {
                            if let Some(points) = current_route_points.as_mut() {
                                points.push(point);
                            }
                        }
                        None => skipped_points += 1,
                    },
                    "wpt" => {
                        current_waypoint = waypoint_from_attributes(&event);
                        if current_waypoint.is_none() {
                            skipped_points += 1;
                        }
                    }
                    _ => {}
                }
                path.push(name);
            }
            Ok(Event::Empty(event)) => {
                let name = event_name(event.name().as_ref());
                match name.as_str() {
                    "trkpt" => match point_from_attributes(&event, &mut point_count) {
                        Some(point) => {
                            if let Some(points) = current_track_segment_points.as_mut() {
                                points.push(point);
                            }
                        }
                        None => skipped_points += 1,
                    },
                    "rtept" => match point_from_attributes(&event, &mut point_count) {
                        Some(point) => {
                            if let Some(points) = current_route_points.as_mut() {
                                points.push(point);
                            }
                        }
                        None => skipped_points += 1,
                    },
                    "wpt" => match waypoint_from_attributes(&event) {
                        Some(waypoint) => {
                            waypoint_count += 1;
                            waypoints.push(Waypoint {
                                id: format!("wpt-{waypoint_count}"),
                                waypoint_type: "warning".into(),
                                lat: waypoint.lat,
                                lng: waypoint.lng,
                                title: "웨이포인트".into(),
                                description: None,
                            });
                        }
                        None => skipped_points += 1,
                    },
                    _ => {}
                }
            }
            Ok(Event::Text(event)) => {
                let text = event
                    .decode()
                    .map(|value| value.to_string())
                    .unwrap_or_default();
                if text.trim().is_empty() {
                    continue;
                }
                append_gpx_text(
                    &path,
                    &text,
                    &mut title,
                    &mut current_track_name,
                    &mut current_route_name,
                    current_waypoint.as_mut(),
                );
            }
            Ok(Event::GeneralRef(event)) => {
                let Some(text) = xml_entity_text(event.as_ref()) else {
                    continue;
                };
                append_gpx_text(
                    &path,
                    text,
                    &mut title,
                    &mut current_track_name,
                    &mut current_route_name,
                    current_waypoint.as_mut(),
                );
            }
            Ok(Event::End(event)) => {
                let name = event_name(event.name().as_ref());
                match name.as_str() {
                    "trkseg" => {
                        if let Some(points) = current_track_segment_points.take() {
                            if points.is_empty() {
                                skipped_points += 1;
                            } else {
                                current_track_segment_index += 1;
                                let fallback = format!("트랙 {track_count}");
                                let base_name = current_track_name.as_deref().unwrap_or(&fallback);
                                let name = if current_track_segment_index > 1 {
                                    format!("{base_name} {}", current_track_segment_index)
                                } else {
                                    base_name.to_string()
                                };
                                segments.push(RouteSegment {
                                    id: format!("seg-{}", segments.len() + 1),
                                    name: Some(name),
                                    points,
                                });
                            }
                        }
                    }
                    "rte" => {
                        if let Some(points) = current_route_points.take() {
                            if points.is_empty() {
                                skipped_points += 1;
                            } else {
                                let name = current_route_name
                                    .clone()
                                    .unwrap_or_else(|| format!("루트 {route_count}"));
                                segments.push(RouteSegment {
                                    id: format!("seg-{}", segments.len() + 1),
                                    name: Some(name),
                                    points,
                                });
                            }
                        }
                    }
                    "wpt" => {
                        if let Some(waypoint) = current_waypoint.take() {
                            waypoint_count += 1;
                            waypoints.push(Waypoint {
                                id: format!("wpt-{waypoint_count}"),
                                waypoint_type: normalize_waypoint_type(
                                    waypoint
                                        .waypoint_type
                                        .as_deref()
                                        .or(waypoint.symbol.as_deref())
                                        .unwrap_or("warning"),
                                ),
                                lat: waypoint.lat,
                                lng: waypoint.lng,
                                title: if waypoint.title.trim().is_empty() {
                                    "웨이포인트".into()
                                } else {
                                    waypoint.title
                                },
                                description: waypoint.description,
                            });
                        }
                    }
                    _ => {}
                }
                path.pop();
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(AppError::BadRequest("invalid GPX XML".into())),
            _ => {}
        }
    }

    if segments.is_empty() && waypoints.is_empty() {
        return Err(AppError::BadRequest(
            "GPX must contain at least one track, route, or waypoint".into(),
        ));
    }

    if title.is_none() {
        title = segments
            .first()
            .and_then(|segment| segment.name.clone())
            .or_else(|| waypoints.first().map(|waypoint| waypoint.title.clone()));
    }

    Ok(GpxImportResult {
        title,
        segments,
        waypoints,
        skipped_points,
    })
}

fn event_name(name: &[u8]) -> String {
    String::from_utf8_lossy(name)
        .rsplit(':')
        .next()
        .unwrap_or("")
        .to_string()
}

fn append_gpx_text(
    path: &[String],
    text: &str,
    title: &mut Option<String>,
    current_track_name: &mut Option<String>,
    current_route_name: &mut Option<String>,
    current_waypoint: Option<&mut PendingWaypoint>,
) {
    let current = path.last().map(String::as_str).unwrap_or("");
    let parent = path.iter().rev().nth(1).map(String::as_str).unwrap_or("");
    match (parent, current) {
        ("metadata", "name") => append_optional_text(title, text),
        ("trk", "name") => append_optional_text(current_track_name, text),
        ("rte", "name") => append_optional_text(current_route_name, text),
        ("wpt", "name") => {
            if let Some(waypoint) = current_waypoint {
                waypoint.title.push_str(text);
            }
        }
        ("wpt", "desc") => {
            if let Some(waypoint) = current_waypoint {
                append_optional_text(&mut waypoint.description, text);
            }
        }
        ("wpt", "type") => {
            if let Some(waypoint) = current_waypoint {
                append_optional_text(&mut waypoint.waypoint_type, text);
            }
        }
        ("wpt", "sym") => {
            if let Some(waypoint) = current_waypoint {
                append_optional_text(&mut waypoint.symbol, text);
            }
        }
        _ => {}
    }
}

fn append_optional_text(target: &mut Option<String>, text: &str) {
    match target {
        Some(value) => value.push_str(text),
        None => *target = Some(text.to_string()),
    }
}

fn xml_entity_text(entity: &[u8]) -> Option<&'static str> {
    match entity {
        b"amp" => Some("&"),
        b"lt" => Some("<"),
        b"gt" => Some(">"),
        b"quot" => Some("\""),
        b"apos" => Some("'"),
        _ => None,
    }
}

fn point_from_attributes(
    event: &quick_xml::events::BytesStart<'_>,
    point_count: &mut usize,
) -> Option<RoutePoint> {
    let (lat, lng) = lat_lng_from_attributes(event)?;
    *point_count += 1;
    Some(RoutePoint {
        id: format!("pt-{point_count}"),
        lat,
        lng,
    })
}

fn waypoint_from_attributes(event: &quick_xml::events::BytesStart<'_>) -> Option<PendingWaypoint> {
    let (lat, lng) = lat_lng_from_attributes(event)?;
    Some(PendingWaypoint {
        lat,
        lng,
        ..Default::default()
    })
}

fn lat_lng_from_attributes(event: &quick_xml::events::BytesStart<'_>) -> Option<(f64, f64)> {
    let mut lat = None;
    let mut lng = None;
    for attribute in event.attributes().flatten() {
        let key = event_name(attribute.key.as_ref());
        let value = String::from_utf8_lossy(attribute.value.as_ref());
        match key.as_str() {
            "lat" => lat = value.parse::<f64>().ok(),
            "lon" | "lng" => lng = value.parse::<f64>().ok(),
            _ => {}
        }
    }
    let lat = lat?;
    let lng = lng?;
    if lat.is_finite()
        && lng.is_finite()
        && (-90.0..=90.0).contains(&lat)
        && (-180.0..=180.0).contains(&lng)
    {
        Some((lat, lng))
    } else {
        None
    }
}

fn normalize_waypoint_type(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "start" | "출발" | "시작" => "start",
        "finish" | "도착" | "종료" => "finish",
        "fuel" | "gas" | "petrol" | "주유" | "주유소" => "fuel",
        "food" | "restaurant" | "식사" | "음식" => "food",
        "camp" | "캠프" | "캠핑" => "camp",
        "warning" | "주의" | "위험" | "경고" => "warning",
        _ => "warning",
    }
    .into()
}

async fn migrate(db: &Pool<Sqlite>) -> anyhow::Result<()> {
    sqlx::query("PRAGMA foreign_keys = ON").execute(db).await?;
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(db)
    .await?;
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS route_segments (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(db)
    .await?;
    add_column_if_missing(
        db,
        "route_segments",
        "name",
        "ALTER TABLE route_segments ADD COLUMN name TEXT NOT NULL DEFAULT ''",
    )
    .await?;
    add_column_if_missing(
        db,
        "route_segments",
        "sort_order",
        "ALTER TABLE route_segments ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS route_points (
            id TEXT PRIMARY KEY,
            segment_id TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            sort_order INTEGER NOT NULL,
            FOREIGN KEY(segment_id) REFERENCES route_segments(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(db)
    .await?;
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS waypoints (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            type TEXT NOT NULL,
            lat REAL NOT NULL,
            lng REAL NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(db)
    .await?;
    add_column_if_missing(
        db,
        "waypoints",
        "sort_order",
        "ALTER TABLE waypoints ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
    )
    .await?;
    Ok(())
}

fn sqlite_pool_options(max_connections: u32) -> SqlitePoolOptions {
    SqlitePoolOptions::new()
        .max_connections(max_connections)
        .after_connect(|connection, _metadata| {
            Box::pin(async move {
                sqlx::query("PRAGMA foreign_keys = ON")
                    .execute(connection)
                    .await?;
                Ok(())
            })
        })
}

async fn add_column_if_missing(
    db: &Pool<Sqlite>,
    table: &str,
    column: &str,
    statement: &str,
) -> anyhow::Result<()> {
    let pragma = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&pragma).fetch_all(db).await?;
    let exists = rows
        .iter()
        .any(|row| row.get::<String, _>("name").eq_ignore_ascii_case(column));
    if !exists {
        sqlx::query(statement).execute(db).await?;
    }
    Ok(())
}

fn ensure_sqlite_file(database_url: &str) -> anyhow::Result<()> {
    let Some(path) = database_url.strip_prefix("sqlite://") else {
        return Ok(());
    };
    if path == ":memory:" || path.starts_with("?") {
        return Ok(());
    }
    if !std::path::Path::new(path).exists() {
        std::fs::File::create(path)
            .with_context(|| format!("failed to create sqlite db: {path}"))?;
    }
    Ok(())
}

fn validate_project(project: &Project) -> Result<(), AppError> {
    if project.id.trim().is_empty() {
        return Err(AppError::BadRequest("project id is required".into()));
    }
    if project.title.trim().is_empty() {
        return Err(AppError::BadRequest("project title is required".into()));
    }
    if project.created_at.trim().is_empty() || project.updated_at.trim().is_empty() {
        return Err(AppError::BadRequest(
            "project metadata dates are required".into(),
        ));
    }
    validate_timestamp(&project.created_at, "project created_at")?;
    validate_timestamp(&project.updated_at, "project updated_at")?;
    if project.segments.is_empty() {
        return Err(AppError::BadRequest(
            "at least one route segment is required".into(),
        ));
    }
    let mut segment_ids = HashSet::new();
    let mut point_ids = HashSet::new();
    let mut waypoint_ids = HashSet::new();
    for segment in &project.segments {
        validate_route_segment(segment)?;
        if !segment_ids.insert(segment.id.as_str()) {
            return Err(AppError::BadRequest(
                "route segment id must be unique".into(),
            ));
        }
        for point in &segment.points {
            validate_id(&point.id, "route point id")?;
            if !point_ids.insert(point.id.as_str()) {
                return Err(AppError::BadRequest("route point id must be unique".into()));
            }
            validate_coordinate(point.lat, point.lng, "route point")?;
        }
    }
    for waypoint in &project.waypoints {
        validate_id(&waypoint.id, "waypoint id")?;
        if !waypoint_ids.insert(waypoint.id.as_str()) {
            return Err(AppError::BadRequest("waypoint id must be unique".into()));
        }
        validate_coordinate(waypoint.lat, waypoint.lng, "waypoint")?;
        if waypoint.title.trim().is_empty() {
            return Err(AppError::BadRequest("waypoint title is required".into()));
        }
        if !matches!(
            waypoint.waypoint_type.as_str(),
            "start" | "finish" | "fuel" | "food" | "camp" | "warning"
        ) {
            return Err(AppError::BadRequest("unsupported waypoint type".into()));
        }
    }
    Ok(())
}

fn validate_route_segment(segment: &RouteSegment) -> Result<(), AppError> {
    validate_id(&segment.id, "route segment id")?;
    let mut point_ids = HashSet::new();
    for point in &segment.points {
        validate_id(&point.id, "route point id")?;
        if !point_ids.insert(point.id.as_str()) {
            return Err(AppError::BadRequest("route point id must be unique".into()));
        }
        validate_coordinate(point.lat, point.lng, "route point")?;
    }
    Ok(())
}

fn validate_id(value: &str, label: &str) -> Result<(), AppError> {
    if value.trim().is_empty() {
        return Err(AppError::BadRequest(format!("{label} is required")));
    }
    Ok(())
}

fn validate_coordinate(lat: f64, lng: f64, label: &str) -> Result<(), AppError> {
    if !lat.is_finite()
        || !lng.is_finite()
        || !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lng)
    {
        return Err(AppError::BadRequest(format!(
            "{label} coordinate is invalid"
        )));
    }
    Ok(())
}

fn validate_timestamp(value: &str, label: &str) -> Result<(), AppError> {
    if is_utc_timestamp(value) {
        return Ok(());
    }
    Err(AppError::BadRequest(format!(
        "{label} must be an ISO UTC timestamp"
    )))
}

fn is_utc_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() < 20 || bytes.last() != Some(&b'Z') {
        return false;
    }
    if bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
        || bytes.get(13) != Some(&b':')
        || bytes.get(16) != Some(&b':')
    {
        return false;
    }
    if !bytes[0..4].iter().all(u8::is_ascii_digit)
        || !bytes[5..7].iter().all(u8::is_ascii_digit)
        || !bytes[8..10].iter().all(u8::is_ascii_digit)
        || !bytes[11..13].iter().all(u8::is_ascii_digit)
        || !bytes[14..16].iter().all(u8::is_ascii_digit)
        || !bytes[17..19].iter().all(u8::is_ascii_digit)
    {
        return false;
    }
    if bytes.len() > 20 {
        if bytes.get(19) != Some(&b'.') {
            return false;
        }
        if bytes[20..bytes.len() - 1].is_empty()
            || !bytes[20..bytes.len() - 1].iter().all(u8::is_ascii_digit)
        {
            return false;
        }
    }

    let month = two_digit_number(&bytes[5..7]);
    let day = two_digit_number(&bytes[8..10]);
    let hour = two_digit_number(&bytes[11..13]);
    let minute = two_digit_number(&bytes[14..16]);
    let second = two_digit_number(&bytes[17..19]);
    (1..=12).contains(&month)
        && (1..=31).contains(&day)
        && hour <= 23
        && minute <= 59
        && second <= 59
}

fn two_digit_number(value: &[u8]) -> u8 {
    (value[0] - b'0') * 10 + (value[1] - b'0')
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

#[derive(Debug)]
enum AppError {
    BadRequest(String),
    Sqlx(sqlx::Error),
    NotFound,
}

impl From<sqlx::Error> for AppError {
    fn from(error: sqlx::Error) -> Self {
        Self::Sqlx(error)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        match self {
            AppError::BadRequest(message) => (StatusCode::BAD_REQUEST, message).into_response(),
            AppError::Sqlx(error) => {
                tracing::error!(%error, "database error");
                (StatusCode::INTERNAL_SERVER_ERROR, "database error").into_response()
            }
            AppError::NotFound => (StatusCode::NOT_FOUND, "project not found").into_response(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_project_accepts_valid_payload() {
        let project = valid_project();

        assert!(validate_project(&project).is_ok());
    }

    #[test]
    fn validate_project_rejects_missing_segments() {
        let mut project = valid_project();
        project.segments = Vec::new();

        assert_bad_request(
            validate_project(&project),
            "at least one route segment is required",
        );
    }

    #[test]
    fn validate_project_rejects_invalid_metadata_dates() {
        let mut project = valid_project();
        project.updated_at = "not-a-date".into();

        assert_bad_request(
            validate_project(&project),
            "project updated_at must be an ISO UTC timestamp",
        );
    }

    #[test]
    fn validate_project_rejects_out_of_range_route_point() {
        let mut project = valid_project();
        project.segments[0].points[0].lat = 91.0;

        assert_bad_request(
            validate_project(&project),
            "route point coordinate is invalid",
        );
    }

    #[test]
    fn validate_project_rejects_unsupported_waypoint_type() {
        let mut project = valid_project();
        project.waypoints[0].waypoint_type = "hotel".into();

        assert_bad_request(validate_project(&project), "unsupported waypoint type");
    }

    #[test]
    fn validate_project_rejects_duplicate_segment_ids() {
        let mut project = valid_project();
        project.segments.push(RouteSegment {
            id: project.segments[0].id.clone(),
            name: Some("중복 구간".into()),
            points: Vec::new(),
        });

        assert_bad_request(
            validate_project(&project),
            "route segment id must be unique",
        );
    }

    #[test]
    fn validate_project_rejects_duplicate_point_ids() {
        let mut project = valid_project();
        let duplicate_id = project.segments[0].points[0].id.clone();
        project.segments[0].points.push(RoutePoint {
            id: duplicate_id,
            lat: 37.7,
            lng: 127.2,
        });

        assert_bad_request(validate_project(&project), "route point id must be unique");
    }

    #[test]
    fn validate_project_rejects_duplicate_waypoint_ids() {
        let mut project = valid_project();
        project.waypoints.push(Waypoint {
            id: project.waypoints[0].id.clone(),
            waypoint_type: "food".into(),
            lat: 37.8,
            lng: 127.3,
            title: "식사".into(),
            description: None,
        });

        assert_bad_request(validate_project(&project), "waypoint id must be unique");
    }

    #[tokio::test]
    async fn save_project_persists_round_trip() {
        let db = test_db().await;
        let project = valid_project();
        let state = AppState { db: db.clone() };

        let Json(saved) = save_project(State(state), Json(project.clone()))
            .await
            .unwrap();
        let loaded = load_project_by_id(&db, project.id.clone()).await.unwrap();

        assert_eq!(saved.id, project.id);
        assert_eq!(loaded.id, project.id);
        assert_eq!(loaded.title, project.title);
        assert_eq!(loaded.created_at, project.created_at);
        assert_eq!(loaded.updated_at, project.updated_at);
        assert_eq!(loaded.segments.len(), 1);
        assert_eq!(loaded.segments[0].id, project.segments[0].id);
        assert_eq!(loaded.segments[0].name, project.segments[0].name);
        assert_eq!(loaded.segments[0].points.len(), 1);
        assert_eq!(
            loaded.segments[0].points[0].id,
            project.segments[0].points[0].id
        );
        assert_eq!(
            loaded.segments[0].points[0].lat,
            project.segments[0].points[0].lat
        );
        assert_eq!(
            loaded.segments[0].points[0].lng,
            project.segments[0].points[0].lng
        );
        assert_eq!(loaded.waypoints.len(), 2);
        assert_eq!(loaded.waypoints[0].id, project.waypoints[0].id);
        assert_eq!(
            loaded.waypoints[0].waypoint_type,
            project.waypoints[0].waypoint_type
        );
        assert_eq!(loaded.waypoints[0].title, project.waypoints[0].title);
        assert_eq!(loaded.waypoints[1].id, project.waypoints[1].id);
        assert_eq!(loaded.waypoints[1].title, project.waypoints[1].title);
    }

    #[tokio::test]
    async fn sqlite_pool_enables_foreign_keys_on_connections() {
        let db = test_db().await;

        for _ in 0..3 {
            let enabled = sqlx::query("PRAGMA foreign_keys")
                .fetch_one(&db)
                .await
                .unwrap()
                .get::<i64, _>(0);
            assert_eq!(enabled, 1);
        }
    }

    #[tokio::test]
    async fn route_segment_handlers_create_update_delete_segments() {
        let db = test_db().await;
        let state = AppState { db: db.clone() };
        let _ = save_project(State(state.clone()), Json(valid_project()))
            .await
            .unwrap();

        let new_segment = RouteSegment {
            id: "seg-2".into(),
            name: Some("추가 구간".into()),
            points: vec![RoutePoint {
                id: "pt-2".into(),
                lat: 37.8,
                lng: 127.3,
            }],
        };
        let Json(created) = create_route_segment(
            State(state.clone()),
            Path("project-test".into()),
            Json(new_segment.clone()),
        )
        .await
        .unwrap();

        assert_eq!(created.segments.len(), 2);
        assert_eq!(created.segments[1].id, "seg-2");
        assert_eq!(created.segments[1].points[0].id, "pt-2");
        assert!(created.updated_at > "2026-05-28T00:00:00Z".to_string());

        let Json(segments) = list_route_segments(State(state.clone()), Path("project-test".into()))
            .await
            .unwrap();
        assert_eq!(segments.len(), 2);

        let updated_segment = RouteSegment {
            name: Some("수정 구간".into()),
            points: vec![
                RoutePoint {
                    id: "pt-2".into(),
                    lat: 37.9,
                    lng: 127.4,
                },
                RoutePoint {
                    id: "pt-3".into(),
                    lat: 38.0,
                    lng: 127.5,
                },
            ],
            ..new_segment
        };
        let Json(updated) = update_route_segment(
            State(state.clone()),
            Path(("project-test".into(), "seg-2".into())),
            Json(updated_segment),
        )
        .await
        .unwrap();
        assert_eq!(updated.segments[1].name.as_deref(), Some("수정 구간"));
        assert_eq!(updated.segments[1].points.len(), 2);
        assert_eq!(updated.segments[1].points[0].lat, 37.9);

        let Json(deleted) =
            delete_route_segment(State(state), Path(("project-test".into(), "seg-2".into())))
                .await
                .unwrap();
        assert_eq!(deleted.segments.len(), 1);
        assert_eq!(deleted.segments[0].id, "seg-1");
    }

    #[tokio::test]
    async fn route_segment_handlers_reject_invalid_mutations() {
        let db = test_db().await;
        let state = AppState { db };
        let _ = save_project(State(state.clone()), Json(valid_project()))
            .await
            .unwrap();

        let duplicate_point_segment = RouteSegment {
            id: "seg-2".into(),
            name: Some("중복 포인트".into()),
            points: vec![RoutePoint {
                id: "pt-1".into(),
                lat: 37.8,
                lng: 127.3,
            }],
        };
        match create_route_segment(
            State(state.clone()),
            Path("project-test".into()),
            Json(duplicate_point_segment),
        )
        .await
        {
            Err(AppError::BadRequest(message)) => {
                assert_eq!(message, "route point id must be unique");
            }
            _ => panic!("expected duplicate point id rejection"),
        }

        let mismatched_segment = RouteSegment {
            id: "seg-other".into(),
            name: Some("불일치".into()),
            points: Vec::new(),
        };
        match update_route_segment(
            State(state.clone()),
            Path(("project-test".into(), "seg-1".into())),
            Json(mismatched_segment),
        )
        .await
        {
            Err(AppError::BadRequest(message)) => {
                assert_eq!(message, "route segment path id must match payload id");
            }
            _ => panic!("expected path mismatch rejection"),
        }

        match delete_route_segment(State(state), Path(("project-test".into(), "seg-1".into())))
            .await
        {
            Err(AppError::BadRequest(message)) => {
                assert_eq!(message, "at least one route segment is required");
            }
            _ => panic!("expected last segment delete rejection"),
        }
    }

    #[test]
    fn project_to_gpx_exports_track_with_waypoints() {
        let mut project = valid_project();
        project.title = "테스트 & 코스".into();
        project.segments[0].points.push(RoutePoint {
            id: "pt-2".into(),
            lat: 37.55,
            lng: 127.05,
        });

        let xml = project_to_gpx(&project, GpxExportType::Track);

        assert!(xml.contains("creator=\"TourMap Editor\""));
        assert!(xml.contains("<name>테스트 &amp; 코스</name>"));
        assert!(xml.contains("<trk>"));
        assert!(xml.contains("<trkseg><trkpt lat=\"37.5\" lon=\"127\" /><trkpt lat=\"37.55\" lon=\"127.05\" /></trkseg>"));
        assert!(xml.contains(
            "<wpt lat=\"37.6\" lon=\"127.1\"><name>주유</name><desc></desc><type>fuel</type></wpt>"
        ));
    }

    #[test]
    fn project_to_gpx_exports_route_segments() {
        let project = valid_project();

        let xml = project_to_gpx(&project, GpxExportType::Route);

        assert!(xml.contains("<rte><name>구간 1</name><rtept lat=\"37.5\" lon=\"127\" /></rte>"));
        assert!(!xml.contains("<trkseg>"));
    }

    #[test]
    fn gpx_export_type_rejects_unknown_type() {
        let result = GpxExportType::try_from("waypoint");

        match result {
            Err(AppError::BadRequest(message)) => {
                assert_eq!(message, "GPX export type must be track or route");
            }
            _ => panic!("expected bad request for unsupported GPX export type"),
        }
    }

    #[tokio::test]
    async fn export_gpx_handler_returns_xml_response() {
        let response = export_gpx(
            Query(GpxExportQuery {
                export_type: "route".into(),
            }),
            Json(valid_project()),
        )
        .await
        .unwrap()
        .into_response();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).unwrap(),
            "application/gpx+xml; charset=utf-8"
        );
    }

    #[test]
    fn gpx_to_project_parts_imports_tracks_routes_and_waypoints() {
        let xml = r#"
            <gpx version="1.1">
              <metadata><name>서울 &amp; 강원 투어</name></metadata>
              <trk>
                <name>북악 코스</name>
                <trkseg>
                  <trkpt lat="37.5" lon="127.0" />
                  <trkpt lat="37.6" lon="127.1" />
                </trkseg>
              </trk>
              <rte>
                <name>복귀 루트</name>
                <rtept lat="37.7" lon="127.2" />
              </rte>
              <wpt lat="37.8" lon="127.3">
                <name>주유소</name>
                <desc>휴식</desc>
                <type>fuel</type>
              </wpt>
            </gpx>
        "#;

        let result = gpx_to_project_parts(xml).unwrap();

        assert_eq!(result.title.as_deref(), Some("서울 & 강원 투어"));
        assert_eq!(result.segments.len(), 2);
        assert_eq!(result.segments[0].name.as_deref(), Some("북악 코스"));
        assert_eq!(result.segments[0].points.len(), 2);
        assert_eq!(result.segments[1].name.as_deref(), Some("복귀 루트"));
        assert_eq!(result.segments[1].points[0].lat, 37.7);
        assert_eq!(result.waypoints.len(), 1);
        assert_eq!(result.waypoints[0].waypoint_type, "fuel");
        assert_eq!(result.waypoints[0].description.as_deref(), Some("휴식"));
        assert_eq!(result.skipped_points, 0);
    }

    #[test]
    fn gpx_to_project_parts_skips_invalid_coordinates() {
        let xml = r#"
            <gpx version="1.1">
              <trk><trkseg><trkpt lat="91" lon="127" /></trkseg></trk>
              <wpt lat="37.8" lon="127.3"><name>주의</name><sym>경고</sym></wpt>
            </gpx>
        "#;

        let result = gpx_to_project_parts(xml).unwrap();

        assert_eq!(result.segments.len(), 0);
        assert_eq!(result.waypoints.len(), 1);
        assert_eq!(result.waypoints[0].waypoint_type, "warning");
        assert_eq!(result.skipped_points, 2);
    }

    #[test]
    fn gpx_to_project_parts_rejects_empty_gpx() {
        let result = gpx_to_project_parts("<gpx></gpx>");

        match result {
            Err(AppError::BadRequest(message)) => {
                assert_eq!(
                    message,
                    "GPX must contain at least one track, route, or waypoint"
                );
            }
            _ => panic!("expected bad request for empty GPX"),
        }
    }

    #[tokio::test]
    async fn import_gpx_handler_returns_project_parts() {
        let Json(result) = import_gpx(Json(GpxImportPayload {
            xml: r#"<gpx><rte><name>루트</name><rtept lat="37.5" lon="127" /></rte></gpx>"#.into(),
        }))
        .await
        .unwrap();

        assert_eq!(result.segments.len(), 1);
        assert_eq!(result.segments[0].name.as_deref(), Some("루트"));
    }

    fn valid_project() -> Project {
        Project {
            id: "project-test".into(),
            title: "테스트 코스".into(),
            created_at: "2026-05-28T00:00:00Z".into(),
            updated_at: "2026-05-28T00:00:00Z".into(),
            segments: vec![RouteSegment {
                id: "seg-1".into(),
                name: Some("구간 1".into()),
                points: vec![RoutePoint {
                    id: "pt-1".into(),
                    lat: 37.5,
                    lng: 127.0,
                }],
            }],
            waypoints: vec![
                Waypoint {
                    id: "wpt-1".into(),
                    waypoint_type: "fuel".into(),
                    lat: 37.6,
                    lng: 127.1,
                    title: "주유".into(),
                    description: Some(String::new()),
                },
                Waypoint {
                    id: "wpt-2".into(),
                    waypoint_type: "camp".into(),
                    lat: 37.7,
                    lng: 127.2,
                    title: "캠프".into(),
                    description: None,
                },
            ],
        }
    }

    fn assert_bad_request(result: Result<(), AppError>, expected: &str) {
        match result {
            Err(AppError::BadRequest(message)) => assert_eq!(message, expected),
            _ => panic!("expected bad request: {expected}"),
        }
    }

    async fn test_db() -> Pool<Sqlite> {
        let db = sqlite_pool_options(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&db).await.unwrap();
        db
    }
}
