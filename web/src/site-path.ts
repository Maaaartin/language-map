// The build records the deployment prefix in each page, including nested pages.
export function sitePath(path: string) {
  const base = typeof document === 'undefined' ? '/' :
    document.querySelector<HTMLMetaElement>('meta[name="site-base"]')?.content ?? '/';
  return base + path.replace(/^\//, '');
}
