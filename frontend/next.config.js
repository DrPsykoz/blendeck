/** @type {import('next').NextConfig} */
const nextConfig = {
    swcMinify: true,
    productionBrowserSourceMaps: false,
    images: {
        remotePatterns: [
            { protocol: "https", hostname: "i.scdn.co" },
            { protocol: "https", hostname: "mosaic.scdn.co" },
            { protocol: "https", hostname: "image-cdn-ak.spotifycdn.com" },
            { protocol: "https", hostname: "image-cdn-fa.spotifycdn.com" },
        ],
    },
};

module.exports = nextConfig;
