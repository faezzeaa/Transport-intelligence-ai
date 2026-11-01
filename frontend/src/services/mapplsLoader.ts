/**
 * Mappls Web Maps JavaScript SDK v3.0 Singleton Dynamic Loader
 * Handles secure, asynchronous, deduplicated script injection for MapmyIndia / Mappls.
 * Adheres strictly to the official v3.0 distribution endpoint:
 * https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=<STATIC_KEY>
 */

declare global {
  interface Window {
    mappls?: any;
  }
}

let loaderPromise: Promise<any> | null = null;

export interface MapplsLoaderStatus {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Dynamically loads the official Mappls Web Maps SDK v3.0 script.
 * Ensures that duplicate scripts are never injected into the DOM.
 */
export function loadMapplsSdk(staticKey: string): Promise<any> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window environment is not available.'));
  }

  // If already initialized on window
  if (window.mappls && typeof window.mappls.Map === 'function') {
    return Promise.resolve(window.mappls);
  }

  // Return existing in-flight promise if one is already loading
  if (loaderPromise) {
    return loaderPromise;
  }

  const cleanKey = staticKey.trim();
  if (!cleanKey) {
    return Promise.reject(new Error('VITE_MAPPLS_STATIC_KEY is missing or empty.'));
  }

  loaderPromise = new Promise((resolve, reject) => {
    // Check if script tag already exists in DOM
    const scriptSelector = 'script[src*="sdk.mappls.com/map/sdk/web"]';
    const existingScript = document.querySelector<HTMLScriptElement>(scriptSelector);

    const onSdkReady = () => {
      // Poll briefly to ensure window.mappls is populated
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (window.mappls && typeof window.mappls.Map === 'function') {
          clearInterval(interval);
          resolve(window.mappls);
        } else if (attempts > 30) {
          clearInterval(interval);
          loaderPromise = null;
          reject(new Error('Mappls SDK script loaded, but window.mappls.Map was not initialized.'));
        }
      }, 50);
    };

    if (existingScript) {
      if (window.mappls && typeof window.mappls.Map === 'function') {
        resolve(window.mappls);
        return;
      }
      existingScript.addEventListener('load', onSdkReady, { once: true });
      existingScript.addEventListener(
        'error',
        () => {
          loaderPromise = null;
          reject(new Error('Existing Mappls SDK script tag encountered a network error.'));
        },
        { once: true }
      );
      return;
    }

    const script = document.createElement('script');
    script.src = `https://sdk.mappls.com/map/sdk/web?v=3.0&access_token=${encodeURIComponent(cleanKey)}`;
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';

    const timeoutTimer = setTimeout(() => {
      loaderPromise = null;
      reject(new Error('Timed out waiting for Mappls Web Maps SDK v3.0 to load (12s).'));
    }, 12000);

    script.onload = () => {
      clearTimeout(timeoutTimer);
      onSdkReady();
    };

    script.onerror = () => {
      clearTimeout(timeoutTimer);
      loaderPromise = null;
      reject(
        new Error(
          'Failed to load Mappls Web Maps SDK script. Please check network connection or domain whitelisting in Mappls Console.'
        )
      );
    };

    document.head.appendChild(script);
  });

  return loaderPromise;
}

