/** @type {import('next').NextConfig} */
const nextConfig = {
  // The export set typescript.ignoreBuildErrors, which let `next build` succeed with type
  // errors still in the code. That is the opposite of useful here: it hides the one signal
  // that says the UI no longer matches the API it calls. Errors fail the build.
  images: {
    // No Next image optimizer in this deployment, so images are served as they are.
    unoptimized: true,
  },
}

export default nextConfig
