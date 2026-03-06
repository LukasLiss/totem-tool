let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const refresh = localStorage.getItem("refresh_token");
      if (!refresh) throw new Error("NO_REFRESH");
      
      const res = await fetch("http://localhost:8000/token/refresh/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh }),
      });
      
      if (!res.ok) {
        localStorage.clear();
        throw new Error("REFRESH_FAILED");
      }
      
      const data = await res.json();
      localStorage.setItem("access_token", data.access);
      
      return data.access;
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export async function authFetch(
  url: string,
  options: RequestInit = {},
  retry = true
): Promise<Response> {
  const access = localStorage.getItem("access_token");
  
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: access ? `Bearer ${access}` : "",
    },
  });

  if (response.status !== 401 || !retry) {
    return response;
  }

  // Try to refresh the token
  try {
    const newAccess = await refreshAccessToken();
    
    return authFetch(
      url,
      {
        ...options,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${newAccess}`,
        },
      },
      false
    );
  } catch (error) {
    // Refresh failed - signal that auth has expired
    localStorage.clear();
    
    // Dispatch event for AuthContext to pick up
    window.dispatchEvent(new CustomEvent("auth-expired"));
    
    throw new Error("SESSION_EXPIRED");
  }
}