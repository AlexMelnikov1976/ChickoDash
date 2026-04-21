export interface ClickHouseConfig {
  host: string;
  user: string;
  password: string;
}

export interface QueryResult {
  data: any[];
  rows: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
}

// Shape of the JSON body returned by ClickHouse when the query uses
// `FORMAT JSON`. Superset of QueryResult because `exception` is only
// present on error responses.
interface ClickHouseJsonBody {
  data?: any[];
  rows?: number;
  statistics?: {
    elapsed: number;
    rows_read: number;
    bytes_read: number;
  };
  exception?: string;
}

export class ClickHouseClient {
  private config: ClickHouseConfig;

  constructor(config: ClickHouseConfig) {
    this.config = config;
  }

  async query(sql: string): Promise<QueryResult> {
    try {
      const url = `${this.config.host}?user=${this.config.user}&password=${encodeURIComponent(this.config.password)}&database=chicko&add_http_cors_header=1&query=${encodeURIComponent(sql + ' FORMAT JSON')}`;

      const response = await fetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ClickHouse error: ${response.status} - ${errorText}`);
      }

      // В новых @cloudflare/workers-types / lib.dom response.json()
      // возвращает Promise<unknown>. Явный каст к известной форме ответа
      // CH — прагматично и не плодит runtime-проверок для внутреннего API.
      const result = (await response.json()) as ClickHouseJsonBody;

      if (result.exception) {
        throw new Error(result.exception);
      }

      return {
        data: result.data || [],
        rows: result.rows || result.data?.length || 0,
        statistics: result.statistics,
      };
    } catch (error) {
      const err = error as Error;
      throw new Error(`Query execution failed: ${err.message}`);
    }
  }
}
