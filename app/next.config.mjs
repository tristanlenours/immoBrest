/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Site privé : aucune indexation, aucun cache partagé.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' }
        ]
      }
    ];
  }
};

export default nextConfig;
