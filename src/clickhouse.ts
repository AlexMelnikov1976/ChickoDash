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

export class ClickHouseClient {
  private config: ClickHouseConfig;

  constructor(config: ClickHouseConfig) {
    this.config = config;
  }

  async query(sql: string, tenantId?: string): Promise<QueryResult> {
    try {
      const securedQuery = this.applyRowLevelSecurity(sql, tenantId);
      
      // Use URL parameters for auth like the dashboard does
      const url = `${this.config.host}?user=${this.config.user}&password=${encodeURIComponent(this.config.password)}&database=chicko&add_http_cors_header=1&query=${encodeURIComponent(securedQuery + ' FORMAT JSON')}`;
      
      const response = await fetch(url, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`ClickHouse error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
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

  private applyRowLevelSecurity(sql: string, tenantId?: string): string {
    if (!tenantId) {
      return sql;
    }

    const normalizedSQL = sql.trim();
    const upperSQL = normalizedSQL.toUpperCase();
    
    const safeTenantId = tenantId.replace(/'/g, "''");
    const tenantFilter = `tenant_id = '${safeTenantId}'`;
    
    if (upperSQL.includes('WHERE')) {
      return normalizedSQL.replace(/WHERE/i, `WHERE ${tenantFilter} AND`);
    }
    
    let insertPosition = -1;
    
    const groupByMatch = /GROUP\s+BY/i.exec(normalizedSQL);
    if (groupByMatch) {
      insertPosition = groupByMatch.index;
    }
    
    if (insertPosition === -1) {
      const orderByMatch = /ORDER\s+BY/i.exec(normalizedSQL);
      if (orderByMatch) {
        insertPosition = orderByMatch.index;
      }
    }
    
    if (insertPosition === -1) {
      const limitMatch = /LIMIT/i.exec(normalizedSQL);
      if (limitMatch) {
        insertPosition = limitMatch.index;
      }
    }
    
    if (insertPosition > -1) {
      return `${normalizedSQL.substring(0, insertPosition).trim()} WHERE ${tenantFilter} ${normalizedSQL.substring(insertPosition).trim()}`;
    }
    
    return `${normalizedSQL} WHERE ${tenantFilter}`;
  }
}
