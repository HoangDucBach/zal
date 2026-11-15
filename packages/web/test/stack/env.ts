// Must be imported before any "@/lib/api/client" import: the client reads its URL when its module loads.
process.env.NEXT_PUBLIC_ZAL_API_URL ??= "http://localhost:42069";
process.env.NEXT_PUBLIC_ZAL_CHAIN_ID ??= "31337";
process.env.NEXT_PUBLIC_ZAL_RPC_URL ??= "http://localhost:8546";
export const API = process.env.NEXT_PUBLIC_ZAL_API_URL;
