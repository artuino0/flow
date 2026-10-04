export function smokePerformance182(root: string, databaseUrl: string, credentials: {email: string; password: string}, secret: string): Promise<Array<{
  enabled: boolean; timing: string | null; slowRequests: Array<{event:string;path:string;method:string;status:number;totalMs:number;queries:number;trips:number;databaseMs:number}>;
  pages: Record<string,{initialFiles:number;initialGzip:number;prefetchFiles:number}>
}>>
