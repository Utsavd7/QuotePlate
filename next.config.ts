import type { NextConfig } from 'next';

const production = process.env.NODE_ENV === 'production';
const globalSecurityHeaders = [
    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    {
        key: 'Permissions-Policy',
        value: 'camera=(), microphone=(), geolocation=()',
    },
    { key: 'Referrer-Policy', value: 'no-referrer' },
];
const quoteContentSecurityPolicy = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "object-src 'none'",
    production
        ? "script-src 'self' 'unsafe-inline'"
        : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    production
        ? "connect-src 'self'"
        : "connect-src 'self' http: https: ws: wss:",
].join('; ');

const nextConfig: NextConfig = {
    devIndicators: false,
    distDir: process.env.NEXT_DIST_DIR || '.next',
    output: 'standalone',
    async headers() {
        return [
            {
                source: '/:path*',
                headers: globalSecurityHeaders,
            },
            {
                source: '/quote/:path*',
                headers: [
                    { key: 'Content-Security-Policy', value: quoteContentSecurityPolicy },
                ],
            },
            {
                source: '/supplier-portal/:path*',
                headers: [
                    { key: 'Content-Security-Policy', value: quoteContentSecurityPolicy },
                ],
            },
        ];
    },
};

export default nextConfig;
