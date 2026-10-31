import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const SessionContext = createContext<{ user: User | null; ready: boolean }>({
  user: null,
  ready: false,
});
export const useAppSession = () => useContext(SessionContext);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const queryClient = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const { data } = await supabase.auth.getUser();
      if (active) {
        setUser(data.user);
        setReady(true);
      }
    };
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (!["SIGNED_IN", "SIGNED_OUT", "USER_UPDATED"].includes(event)) return;
      setUser(session?.user ?? null);
      setReady(true);
      void router.invalidate();
      if (event !== "SIGNED_OUT") void queryClient.invalidateQueries();
    });
    void refresh();
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [queryClient, router]);
  return <SessionContext.Provider value={{ user, ready }}>{children}</SessionContext.Provider>;
}
