// Import the react JS packages
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { getApiUrl } from "../config/api";

type LocationState = {
  from?: string;
};

type OAuthProvider = "github" | "google";

type LoginOptions = {
  password_login: boolean;
  providers: OAuthProvider[];
};

const NO_LOGIN_OPTIONS: LoginOptions = { password_login: false, providers: [] };

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  github: "GitHub",
  google: "Google",
};

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Sign-in was cancelled.",
  invalid_state: "Your sign-in session expired. Please try again.",
  no_verified_email:
    "Your account has no verified email address. Verify one with the provider and try again.",
  inactive_account: "This account has been deactivated.",
  ambiguous_email:
    "More than one account uses this email address. Contact an administrator.",
  provider_disabled:
    "This sign-in option hasn't been set up on the server yet. Contact an administrator.",
  provider_unreachable: "Could not reach the sign-in provider. Please try again.",
  token_exchange_failed:
    "The sign-in provider rejected the server's request. Contact an administrator.",
  provider_error:
    "The sign-in provider rejected the server's request. Contact an administrator.",
};

const GitHubIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4" fill="currentColor">
    <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.4-4-1.4-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1.1.9 2.3v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
  </svg>
);

const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);

const PROVIDER_ICONS: Record<OAuthProvider, ComponentType> = {
  github: GitHubIcon,
  google: GoogleIcon,
};

// Define the Login function.
export const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  // null while loading.
  const [options, setOptions] = useState<LoginOptions | null>(null);
  // The password form is only for the admin, so it starts folded away
  // unless the server runs with DEV_LOGIN (local development).
  const [showAdminLogin, setShowAdminLogin] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  const from =
    (location.state as LocationState)?.from ?? "/upload";

  const oauthError = searchParams.get("oauth_error");

  useEffect(() => {
    let cancelled = false;
    fetch(getApiUrl('/auth/login-options/'))
      .then((r) => (r.ok ? r.json() : NO_LOGIN_OPTIONS))
      .then((data) => {
        if (!cancelled) {
          setOptions({
            password_login: Boolean(data.password_login),
            providers: data.providers ?? [],
          });
          setShowAdminLogin(Boolean(data.password_login));
        }
      })
      .catch(() => {
        if (!cancelled) setOptions(NO_LOGIN_OPTIONS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startOAuth = (provider: OAuthProvider) => {
    const next = encodeURIComponent(from);
    window.location.href = getApiUrl(`/auth/oauth/${provider}/login/?next=${next}`);
  };

  // Create the submit method.
  const submit = async (e) => {
    e.preventDefault();

    const user = {
      username: username,
      password: password,
    };

    try {
    const response = await fetch(getApiUrl('/token/'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(user),
    });

    if (!response.ok) {
      throw new Error('Login failed');
    }

    const data = await response.json();

    // Initialize the access & refresh token in localStorage
    localStorage.clear();
    localStorage.setItem('access_token', data.access);
    localStorage.setItem('refresh_token', data.refresh);


    //window.history.back();
    navigate(from, { replace: true });
  } catch {
    alert("Invalid credentials or server error.");
  }

  };

  const passwordForm = (
    <form onSubmit={submit}>
      <div className="grid gap-6">
        <div className="grid gap-3">
          <Label htmlFor="username">Email or username</Label>
          <Input
            id="username"
            type="text"
            autoComplete="username"
            placeholder="Enter email or username"
            required
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <div className="grid gap-3">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            placeholder="Enter password"
            required
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <Button type="submit" className="w-full">
          Login
        </Button>
      </div>
    </form>
  );

  const renderOAuthButtons = (providers: OAuthProvider[]) => (
    <div className="grid gap-3">
      {/* Accounts can only be created through a provider, never with a
          password — say so, or new users go looking for a sign-up form. */}
      <p className="text-muted-foreground text-center text-sm">
        Register and log in with:
      </p>
      {providers.map((provider) => {
        const Icon = PROVIDER_ICONS[provider];
        return (
          <Button
            key={provider}
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => startOAuth(provider)}
          >
            <Icon />
            Continue with {PROVIDER_LABELS[provider]}
          </Button>
        );
      })}
    </div>
  );

  // Each OAuth button hands off to the provider, where the user signs in or
  // signs up; the first sign-in creates the TOTeM account. /token/ is always
  // enabled, so the admin can use the password form on any server.
  let body: ReactNode;
  if (options === null) {
    body = <div className="h-24" aria-busy="true" />;
  } else {
    body = (
      <>
        {options.providers.length > 0 ? (
          renderOAuthButtons(options.providers)
        ) : (
          <p className="text-muted-foreground text-center text-sm">
            No OAuth login options are set up. Contact the admin.
          </p>
        )}
        {showAdminLogin ? (
          <>
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <span className="bg-border h-px flex-1" />
              or
              <span className="bg-border h-px flex-1" />
            </div>
            <p className="text-muted-foreground text-center text-sm">
              Admin login with email and password
            </p>
            {passwordForm}
          </>
        ) : (
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground w-fit text-left text-xs underline-offset-4 hover:underline"
            onClick={() => setShowAdminLogin(true)}
          >
            Admin login
          </button>
        )}
      </>
    );
  }

  return (
    // Fixed width: the parent centres its children, so without one the card
    // shrinks to fit its contents and changes size between login modes.
    <div className="flex flex-col gap-6 justify-center h-dvh w-full max-w-md px-4">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>
            Sign in or sign up with your GitHub or Google account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6">
            {oauthError && (
              <p role="alert" className="text-destructive text-center text-sm">
                {OAUTH_ERROR_MESSAGES[oauthError] ?? "Sign-in failed. Please try again."}
              </p>
            )}
            {body}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
