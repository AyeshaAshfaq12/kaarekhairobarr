import { NextResponse, type NextRequest } from 'next/server'

// Edge-safe gate for /portal/*. It only checks that a session cookie exists and keeps the
// cookie's 30-day expiry sliding; the session itself is validated server-side on every page.
const SESSION_COOKIE = 'kkb_session'
const PUBLIC_PATHS = ['/portal/login', '/portal/signup', '/portal/verify', '/portal/reset']

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`))
  const token = request.cookies.get(SESSION_COOKIE)?.value

  if (!isPublic && !token) {
    const loginUrl = new URL('/portal/login', request.url)
    if (pathname !== '/portal' && pathname !== '/portal/') {
      loginUrl.searchParams.set('next', `${pathname}${search}`)
    }
    return NextResponse.redirect(loginUrl)
  }

  const response = NextResponse.next()
  if (token) {
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    })
  }
  return response
}

export const config = {
  matcher: ['/portal', '/portal/:path*'],
}
