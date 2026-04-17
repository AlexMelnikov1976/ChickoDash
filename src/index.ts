import { generateToken, validateToken, extractBearerToken, JWTPayload } from './auth';
import { ClickHouseClient } from './clickhouse';

export interface Env {
  CLICKHOUSE_HOST: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
  JWT_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ 
        status: 'ok', 
        timestamp: new Date().toISOString() 
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }

    if (url.pathname === '/api/query' && request.method === 'POST') {
      return handleQuery(request, env);
    }

    return new Response('Not Found', { status: 404 });
  },
};

async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email: string; password: string };
    
    if (body.email === 'admin@chicko.ru' && body.password === 'demo123') {
      const token = await generateToken({
        user_id: 'user_001',
        tenant_id: 'tenant_chicko',
        email: body.email,
        permissions: ['read', 'write']
      }, env.JWT_SECRET || 'temp-secret-key-change-in-production');
      
      return new Response(JSON.stringify({ 
        success: true,
        token,
        expires_in: 86400
      }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    return new Response(JSON.stringify({ 
      error: 'Invalid credentials' 
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const err = error as Error;
    return new Response(JSON.stringify({ 
      error: 'Login failed',
      message: err.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleQuery(request: Request, env: Env): Promise<Response> {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    
    if (!token) {
      return new Response(JSON.stringify({ 
        error: 'Unauthorized',
        message: 'Missing or invalid Authorization header' 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const payload = await validateToken(token, env.JWT_SECRET || 'temp-secret-key-change-in-production');
    
    if (!payload) {
      return new Response(JSON.stringify({ 
        error: 'Unauthorized',
        message: 'Invalid or expired token' 
      }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    
    const body = await request.json() as { query: string };
    
    const clickhouse = new ClickHouseClient({
      host: env.CLICKHOUSE_HOST || 'http://localhost:8123',
      user: env.CLICKHOUSE_USER || 'default',
      password: env.CLICKHOUSE_PASSWORD || '',
    });
    
    const result = await clickhouse.query(body.query, payload.tenant_id);
    
    return new Response(JSON.stringify({ 
      status: 'success',
      data: result.data,
      rows: result.rows,
      statistics: result.statistics,
      tenant_id: payload.tenant_id,
      user_id: payload.user_id
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    const err = error as Error;
    return new Response(JSON.stringify({ 
      error: 'Query execution failed',
      message: err.message 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
