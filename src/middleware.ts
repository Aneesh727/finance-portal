import { NextResponse, type NextRequest } from 'next/server';

/** Page routes need a session cookie (the API re-validates it on every call). */
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open = pathname === '/login' || pathname === '/setup';
  const has = req.cookies.has('fp_session');
  if (!has && !open) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
export const config = { matcher: ['/((?!api/|_next/|favicon.ico|.*\\.[a-z0-9]+$).*)'] };
