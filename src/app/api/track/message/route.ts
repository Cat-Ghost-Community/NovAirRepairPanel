/** Customer conversations are unavailable in this internal-only release. */
export function POST(request: Request):Promise<Response>;
export async function POST(){
  return Response.json({error:'این مسیر ارتباطی در دسترس نیست.'},{status:410,headers:{'Cache-Control':'no-store'}});
}
