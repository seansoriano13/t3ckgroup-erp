import { useEffect, useRef, createContext, useState, useContext } from "react";
import { employeeService } from "../services/employeeService.js";
import { storageService } from "../services/storageService.js";
import toast from "react-hot-toast";
import { supabase } from "../lib/supabase.js";
import { isRecoveryActive } from "../lib/recoveryFlag.js";
import { isResetPasswordPath } from "../lib/recoveryLink.js";
import { setErrorTrackingUser } from "../lib/errorTracking.js";

const AuthContext = createContext(null);
const PROFILE_CACHE_KEY = "t3ck_user_profile";
const HTTP_URL_RE = /^https?:\/\//i;

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true); // Always start loading to verify session integrity
  const [initFinished, setInitFinished] = useState(false); // New flag to prevent infinite loops
  const userEmailRef = useRef(null);
  const settledRef = useRef(false); // ensures setIsAuthLoading(false) only fires once

  const resolveProfileMediaUrl = async (path) => {
    if (!path) return null;
    if (HTTP_URL_RE.test(path)) return path;
    try {
      return await storageService.getSignedUrl(path);
    } catch (error) {
      console.warn("Failed to resolve profile media URL:", error);
      return null;
    }
  };

  useEffect(() => {
    userEmailRef.current = user?.email;
  }, [user]);

  // Error reports carry who it happened to (id, role, department), nothing else.
  useEffect(() => {
    setErrorTrackingUser(user);
  }, [user?.id, user?.role, user?.department, user?.subDepartment]); // eslint-disable-line react-hooks/exhaustive-deps

  const resolveEmployee = async (sessionUser, isMounted) => {
    if (!isMounted) return;
    // Skip if we already resolved this user and initialization is finished
    if (userEmailRef.current === sessionUser.email && initFinished) return;

    try {
      const employee = await employeeService.getEmployeeByEmail(sessionUser.email);
      if (!isMounted) return;

      if (employee) {
        const metadata = sessionUser.user_metadata || null;
        const [pictureFromStorage, bannerFromStorage] = await Promise.all([
          resolveProfileMediaUrl(employee.avatarPath),
          resolveProfileMediaUrl(employee.dashboardBannerPath),
        ]);

        const googleFallback = employee.avatarPath
          ? ""
          : metadata?.avatar_url || metadata?.picture || "";

        const mergedUser = {
          ...employee,
          picture: pictureFromStorage || googleFallback,
          dashboardBannerUrl: bannerFromStorage || null,
        };
        
        setUser(mergedUser);
        localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(mergedUser));
      } else {
        console.warn("Auth: No employee record found for", sessionUser.email);
        await logout();
      }
    } catch (err) {
      console.error("Auth: resolveEmployee failed:", err);
      const cached = localStorage.getItem(PROFILE_CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.email === sessionUser.email) {
          setUser(parsed);
        }
      }
    } finally {
      if (isMounted) {
        setIsAuthLoading(false);
        setInitFinished(true);
        settledRef.current = true;
      }
    }
  };

  useEffect(() => {
    let isMounted = true;

    const timeout = setTimeout(() => {
      if (!settledRef.current && isMounted) {
        settledRef.current = true;
        console.warn("Auth: Safety gate triggered - session resolution took too long. This usually indicates a Supabase connection issue or heavy network load.");
        setIsAuthLoading(false);
      }
    }, 15_000);

    // A password reset owns its short-lived recovery session until the new
    // password is set. Resolving the employee off it — or hitting the
    // no-employee branch and calling logout(), which signs the session out and
    // redirects to /login — tears that flow down mid-reset and spends the
    // one-time token. `isRecoveryActive()` is the cross-tab guard: a lingering
    // /login tab sees the recovery session appear via storage sync and must
    // leave it alone too, not just the /reset-password tab itself. The reset
    // page redirects out with a full load once done, booting a clean resolve.
    const skipForRecovery = () =>
      isResetPasswordPath(window.location.pathname) || isRecoveryActive();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      // Only the session-bearing branch is the hazard: it resolves the employee
      // and, finding none, logs out. A SIGNED_OUT with no session has nothing
      // left to protect, so it must still clear this tab — guarding it too
      // would leave every tab unable to react to a genuine sign-out.
      if (session?.user) {
        if (skipForRecovery()) {
          if (isMounted) {
            setIsAuthLoading(false);
            setInitFinished(true);
            settledRef.current = true;
          }
          return;
        }
        resolveEmployee(session.user, isMounted);
      } else {
        if (isMounted) {
          setUser(null);
          localStorage.removeItem(PROFILE_CACHE_KEY);
          setIsAuthLoading(false);
          setInitFinished(true);
          settledRef.current = true;
        }
      }
    });

    // Re-verify session when user returns to the tab
    const handleVisibilityChange = () => {
      if (skipForRecovery()) return;
      if (document.visibilityState === "visible") {
        supabase.auth.getSession().then(({ data: { session } }) => {
          if (session?.user && isMounted) {
            resolveEmployee(session.user, isMounted);
          }
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      isMounted = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount




  const handleLogin = async (googleEmail) => {
    // handleLogin no longer manually updates state. 
    // It just validates that the employee exists before allowing the flow.
    // The onAuthStateChange listener will handle the actual state update once 
    // supabase.auth.signInWithIdToken completes in the component.
    try {
      const dbEmployee = await employeeService.getEmployeeByEmail(googleEmail);
      if (!dbEmployee) {
        toast.error("Unauthorized: Your email is not registered.");
        return false;
      }
      return true;
    } catch (error) {
      console.error("Manual look-up failed:", error);
      toast.error("Connection error. Try again.");
      return false;
    }
  };

  const logout = async () => {
    try {
      localStorage.removeItem(PROFILE_CACHE_KEY);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      toast.success("Logged out successfully.");
      window.location.replace("/login");
    } catch (error) {
      console.error("Error logging out", error);
      toast.error("Failed to logout. Please try again.");
      setUser(null);
      window.location.replace("/login");
    }
  };

  const updateUserPreferences = (nextValues) => {
    setUser((prevUser) => {
      if (!prevUser) return prevUser;
      const merged = { ...prevUser, ...nextValues };
      localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(merged));
      return merged;
    });
  };

  return (
    <AuthContext.Provider
      value={{ user, isAuthLoading, handleLogin, logout, updateUserPreferences }}
    >
      {children}
    </AuthContext.Provider>
  );
};

const noop = async () => {};

/**
 * Signs a Release Notes sample in as a made-up employee (ADR 0030), so a
 * real form inside it reads the sample's department and balances instead
 * of the viewer's own. Only Sample Data uses it; it cannot sign anyone in.
 */
export function SampleAuthProvider({ user, children }) {
  const [value] = useState(() => ({ user, isAuthLoading: false, handleLogin: noop, logout: noop, updateUserPreferences: noop }));
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
