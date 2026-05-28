import { type NextRequest, NextResponse } from "next/server";

const defaultApiBaseUrl = "http://127.0.0.1:4000";

export async function GET(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

export async function PUT(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

export async function DELETE(request: NextRequest, context: RouteContext): Promise<Response> {
  return proxyApiRequest(request, context);
}

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

async function proxyApiRequest(request: NextRequest, context: RouteContext): Promise<Response> {
  const { path } = await context.params;
  const target = apiTargetUrl(path, request.nextUrl.search);
  const headers = forwardedHeaders(request.headers);
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  try {
    const response = await fetch(target, {
      body,
      cache: "no-store",
      headers,
      method: request.method,
    });
    return new Response(response.body, {
      headers: responseHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  } catch {
    return NextResponse.json(
      { message: "TourMap API 서버에 연결하지 못했습니다." },
      { status: 502 },
    );
  }
}

function apiTargetUrl(path: string[], search: string): string {
  const base = process.env.TOURMAP_API_BASE_URL || defaultApiBaseUrl;
  const normalizedBase = base.replace(/\/$/, "");
  return `${normalizedBase}/api/${path.map(encodeURIComponent).join("/")}${search}`;
}

function forwardedHeaders(headers: Headers): Headers {
  const result = new Headers(headers);
  result.delete("host");
  result.delete("connection");
  result.delete("content-length");
  result.delete("accept-encoding");
  return result;
}

function responseHeaders(headers: Headers): Headers {
  const result = new Headers(headers);
  result.delete("content-encoding");
  result.delete("content-length");
  result.delete("transfer-encoding");
  result.delete("connection");
  return result;
}
