import { useEffect, useState } from 'react';

const preferenceKey = 'zaowu-sidebar-collapsed';
const compactQuery = '(max-width: 1100px)';
const mobileQuery = '(max-width: 700px)';

function readViewport() {
  return {
    compact: window.matchMedia?.(compactQuery).matches ?? false,
    mobile: window.matchMedia?.(mobileQuery).matches ?? false,
  };
}

export function useSidebarLayout() {
  const [viewport, setViewport] = useState(readViewport);
  const [preference, setPreference] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem(preferenceKey);
      return saved === 'true' || saved === 'false' ? saved === 'true' : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const queries = [compactQuery, mobileQuery].map((query) => window.matchMedia?.(query));
    const update = () => setViewport(readViewport());
    queries.forEach((query) => query?.addEventListener('change', update));
    return () => queries.forEach((query) => query?.removeEventListener('change', update));
  }, []);

  const collapsed = !viewport.mobile && (preference ?? viewport.compact);
  function toggle() {
    setPreference(!collapsed);
    try {
      localStorage.setItem(preferenceKey, String(!collapsed));
    } catch {
      // Keep the current session usable when browser storage is unavailable.
    }
  }
  return { collapsed, mobile: viewport.mobile, toggle };
}
