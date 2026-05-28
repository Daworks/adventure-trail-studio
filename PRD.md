# TourMap Editor MVP PRD

Version: 0.1  
Status: Draft  
Target: MVP Development

---

# 1. Product Overview

## Summary

TourMap Editor is a desktop-first web application for creating, editing, importing, and exporting GPX-based motorcycle touring routes.

The product focuses on:
- Fast route editing
- GPX workflow
- Satellite map visibility
- Rider-oriented UX
- Minimal and modern UI

This MVP focuses only on:
- Core map editor
- GPX import/export
- Local project save/load

Authentication, collaboration, and cloud sync are intentionally excluded from the MVP.

---

# 2. Goals

## Primary Goals

- Build a usable route editor MVP
- Support GPX import/export
- Enable route editing directly on map
- Save and reopen projects locally
- Provide smooth editing UX

---

# 3. Out of Scope

The following features are excluded from MVP:

- User authentication
- User accounts
- Cloud sync
- Team collaboration
- Public sharing
- Mobile optimization
- Offline map tiles
- Elevation graph
- AI routing

---

# 4. Technical Stack

# Frontend

## Framework
- Next.js (App Router)
- React
- TypeScript

## Styling
- Tailwind CSS

## State Management
- Zustand

## Map SDK
- Kakao Maps SDK
or
- Naver Maps API

## Geometry Processing
- Turf.js

---

# Backend

## Language
- Rust

## Framework
- Axum

## Runtime
- Tokio

---

# Database

## Database
- SQLite

## ORM / Query Layer
Recommended:
- sqlx

Alternative:
- SeaORM

---

# Storage

## Project Storage
- SQLite DB

## GPX Files
- Local upload/download only

---

# 5. Core Features

# 5.1 Map Editor

## Route Creation

Users can:
- Click map to create route points
- Automatically connect points
- Continue drawing routes

---

## Route Editing

### Required Features

#### Move Point
- Drag point to new position

#### Insert Point
- Insert point between existing points

#### Delete Point
- Remove selected point

#### Delete Segment
- Remove selected route section

#### Split Segment
- Split route into multiple segments

---

## Undo / Redo

### Required
- Ctrl/Cmd + Z
- Ctrl/Cmd + Shift + Z

Supported operations:
- Point movement
- Point insertion
- Point deletion
- Segment operations

---

# 5.2 Map Modes

## Required

- Standard map view
- Satellite map view

---

# 5.3 GPX Import

## Upload

Supported:
- .gpx file upload
- Drag & drop

---

## Parsing Targets

Supported:
- Track
- Route
- Waypoint

---

## Import Flow

1. Upload GPX
2. Parse GPX
3. Convert to internal route model
4. Render on map

---

# 5.4 GPX Export

## Export Types

Supported:
- GPX Track
- GPX Route

---

## Export Flow

1. Convert internal model
2. Generate GPX XML
3. Download file

---

# 5.5 Project Save / Load

## Save Project

Users can:
- Save current project

Saved data:
- Routes
- Segments
- Waypoints
- Metadata

---

## Load Project

Users can:
- Reopen existing projects

---

## Project Metadata

Supported:
- Project name
- Created date
- Updated date

---

# 5.6 Waypoints

## Required Types

- Start
- Finish
- Fuel
- Food
- Camp
- Warning

---

## Editable Fields

- Title
- Description
- Icon type

---

# 6. UX / UI Requirements

# Design Direction

The UI should feel:
- Minimal
- Editorial
- Calm
- Functional

References:
- Aesop
- Swiss editorial design
- Modern GIS tools

---

# Layout

## Left Sidebar
- Project list
- Layer controls
- Waypoints

## Main Area
- Interactive map editor

## Right Sidebar
- Properties editor

## Bottom Bar
- Distance
- Segment info

---

# 7. Architecture

# Frontend Architecture

## Core Principle

Map SDK must be abstracted.

Example:

ts interface MapAdapter {   addPolyline()   removePolyline()   addMarker()   setView() } 

This allows future migration:
- Kakao Maps
- Naver Maps
- MapLibre

---

# Backend Architecture

## API Style

REST API

---

## Suggested Modules

### Route Module
- Create route
- Update route
- Delete route

### GPX Module
- Import GPX
- Export GPX

### Project Module
- Save project
- Load project

---

# 8. Data Model

# RoutePoint

ts type RoutePoint = {   id: string   lat: number   lng: number } 

---

# RouteSegment

ts type RouteSegment = {   id: string   points: RoutePoint[] } 

---

# Waypoint

ts type Waypoint = {   id: string   type: 'fuel' | 'camp' | 'warning'   lat: number   lng: number   title: string   description?: string } 

---

# Project

ts type Project = {   id: string   title: string   createdAt: string   updatedAt: string   segments: RouteSegment[]   waypoints: Waypoint[] } 

---

# 9. Database Schema

# projects

sql CREATE TABLE projects (   id TEXT PRIMARY KEY,   title TEXT NOT NULL,   created_at TEXT NOT NULL,   updated_at TEXT NOT NULL ); 

---

# route_segments

sql CREATE TABLE route_segments (   id TEXT PRIMARY KEY,   project_id TEXT NOT NULL ); 

---

# route_points

sql CREATE TABLE route_points (   id TEXT PRIMARY KEY,   segment_id TEXT NOT NULL,   lat REAL NOT NULL,   lng REAL NOT NULL,   sort_order INTEGER NOT NULL ); 

---

# waypoints

sql CREATE TABLE waypoints (   id TEXT PRIMARY KEY,   project_id TEXT NOT NULL,   type TEXT NOT NULL,   lat REAL NOT NULL,   lng REAL NOT NULL,   title TEXT NOT NULL,   description TEXT ); 

---

# 10. Performance Requirements

## Target

- Smooth editing up to 10,000 route points
- Fast route rendering
- Low latency interaction

---

# Optimization Strategy

- Incremental rendering
- Memoization
- Geometry simplification
- Avoid full rerender

---

# 11. MVP Deliverables

# Included

- Map rendering
- Satellite toggle
- Route drawing
- Route editing
- GPX import
- GPX export
- Project save/load
- Waypoints
- Undo/Redo

---

# Excluded

- Authentication
- Collaboration
- Cloud sync
- Public sharing
- Mobile app
- Offline maps

---

# 12. Recommended Development Order

# Phase 1
- Next.js setup
- Map SDK integration
- Basic map rendering

---

# Phase 2
- Route drawing engine
- Point editing
- Segment rendering

---

# Phase 3
- Undo/Redo system
- Geometry utilities

---

# Phase 4
- GPX import/export

---

# Phase 5
- SQLite persistence
- Project save/load

---

# Phase 6
- Waypoints
- UI polish

---

# 13. Long-term Direction

Long-term architecture should support:

- MapLibre migration
- Rust WASM geometry engine
- Desktop app via Tauri
- Realtime collaboration
- Offline map support

---

# 14. Product Positioning

TourMap Editor is not a navigation app.

It is:
- A GPX editing studio
- A route planning tool
- A rider-oriented map editor

The long-term vision is:
“Figma for adventure riders.”

---
