import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useNavigate, useLocation, Navigate } from "react-router";
import toast from "react-hot-toast";
import { useAuth } from "../../context/AuthContext";
import PrimaryButton from "../../components/PrimaryButton";
import { Button } from "../../components/ui/button";
import { useTheme } from "../../hooks/useTheme";
import { supabase } from "../../lib/supabase";
import { passwordService } from "../../services/passwordService";
import { resolvePostLoginPath } from "../../utils/authRedirect.js";
import { AUTH_INPUT_STYLE as INPUT_STYLE } from "../../constants/authForm.js";

export default function Login() {
  const { handleLogin, user, isAuthLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();

  const redirectTo = resolvePostLoginPath(location.state?.from);

  const [email, setEmail] = useState(
    () => (import.meta.env.MODE !== "test" ? import.meta.env.VITE_MAGIC_LOGIN_EMAIL || "" : "")
  );
  const [password, setPassword] = useState(
    () => (import.meta.env.MODE !== "test" ? import.meta.env.VITE_MAGIC_LOGIN_PASSWORD || "" : "")
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If the user is already authenticated (e.g. swiped back to /login, or
  // the session was restored on reload), redirect immediately.
  // Show nothing while auth is still resolving to prevent a flash of the form.
  if (isAuthLoading) return null;
  if (user) {
    return <Navigate to={redirectTo} replace />;
  }

  const handleManualLogin = async (e) => {
    e.preventDefault();

    if (!email || !password) {
      toast.error("Please enter your email and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const isAuthorized = await handleLogin(data.user.email);
      if (isAuthorized) {
        navigate(redirectTo);
      }
    } catch (error) {
      console.error("Manual login failed:", error);
      // The provider's own "Invalid login credentials" doesn't say what to do
      // next; anything else (network, rate limit) is shown as-is, since that
      // guidance would be wrong for it.
      const isBadCredentials = /invalid login credentials/i.test(error.message || "");
      toast.error(
        isBadCredentials
          ? "Incorrect email or password. Use Forgot password? below, or sign in with Google."
          : error.message || "Login failed. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      toast.error("Enter your email address first.");
      return;
    }
    try {
      await passwordService.requestPasswordReset(email);
      toast.success("Check your email for a link to reset your password.");
    } catch (error) {
      console.error("Password reset request failed:", error);
      toast.error(error.message || "Could not send reset email.");
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: "google",
        token: credentialResponse.credential,
      });

      if (error) throw error;

      const googleEmail = data.user.email;
      const googlePictureUrl =
        data.user.user_metadata.avatar_url ||
        data.user.user_metadata.picture ||
        "";

      const isAuthorized = await handleLogin(googleEmail, googlePictureUrl);

      if (isAuthorized) {
        navigate(redirectTo);
      }
    } catch (error) {
      console.error("Google login failed:", error);
      toast.error("Google login failed: " + (error.message || "Network issue"));
    }
  };

  const handleGoogleError = () => {
    toast.error("Failed to connect to Google.");
  };

  return (
    <div className="bg-white grid grid-cols-1 lg:grid-cols-2 min-h-screen font-sans">
      {/* LEFT: Form Panel */}
      <div className="flex flex-col justify-center px-8 sm:px-16 lg:px-24 xl:px-32 py-12 relative z-10">
        <div className="max-w-md w-full mx-auto space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-mauve-12">
              Welcome to <span className="text-primary">T3ckgroup</span>
            </h1>
            <p className="text-mauve-10 mt-2 font-medium">
              Sign in to access the employee portal.
            </p>
          </div>

          {/* Email + password form */}
          <form className="grid gap-5" onSubmit={handleManualLogin}>
            <div className="grid gap-2">
              <label className="text-xs font-bold text-mauve-11 uppercase tracking-wider">
                Email Address
              </label>
              <input
                className={`${INPUT_STYLE} cursor-text`}
                type="email"
                autoComplete="username"
                placeholder="name@t3ckgroup.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-bold text-mauve-11 uppercase tracking-wider">
                  Password
                </label>
                <Button
                  type="button"
                  variant="link"
                  onClick={handleForgotPassword}
                  className="h-auto p-0 text-xs font-medium text-mauve-11 hover:underline"
                >
                  Forgot password?
                </Button>
              </div>
              <input
                className={`${INPUT_STYLE} cursor-text`}
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {/* Action Area */}
            <div className="pt-6 border-t border-mauve-6 mt-3">
              <p className="text-sm font-bold text-mauve-10 mb-4">
                Sign in with your email and password, or your corporate Google account.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 items-center">
                <PrimaryButton
                  label={isSubmitting ? "Logging in..." : "Log In"}
                  className={`w-full sm:w-auto ${isSubmitting ? "opacity-70 cursor-not-allowed" : ""}`}
                />

                <div className="w-full sm:w-auto flex justify-center drop-shadow-md hover:scale-105 transition-transform">
                  <GoogleLogin
                    onSuccess={handleGoogleSuccess}
                    onError={handleGoogleError}
                    useOneTap
                    theme={theme === "light" ? "outline" : "filled_black"} // 👈 Applies theme dynamically
                    shape="rectangular"
                    size="large"
                  />
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>

      {/* RIGHT: Cover Image */}
      {/* Hidden on mobile, visible on large screens */}
      <div className="hidden lg:block h-screen p-4 relative">
        <div className="h-full w-full flex items-center justify-center rounded-2xl overflow-hidden bg-mauve-2 relative">
          {/* Optional: A subtle gradient overlay to make the image fit the dark theme better */}
          {/* <div className="absolute inset-0 z-10 pointer-events-none" />

          <img
            src="/login-image-portrait.png"
            className="pointer-events-none object-cover h-full w-full opacity-90"
            alt="Corporate Banner"
          /> */}

          <video
            src="/intro-tg-white.mp4"
            autoPlay
            muted
            loop
            className="pointer-events-none object-cover h-full w-full"
          ></video>
        </div>
      </div>
    </div>
  );
}
