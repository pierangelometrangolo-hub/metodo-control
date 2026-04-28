"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.error("Errore controllo sessione:", error.message);
      return;
    }

    if (session) {
      router.push("/dashboard");
    }
  }

  async function handleLogin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMessage("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setErrorMessage("Email o password non corrette. Riprova.");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="min-h-screen bg-[#f5f3ef] px-5 py-6 text-[#2B2D2F] md:px-8 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center">
        <section className="grid w-full gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          
          {/* LEFT PANEL */}
          <div className="rounded-[24px] border border-[#e7dfd8] bg-[#fcfbf9] p-6 shadow-[0_6px_16px_rgba(43,45,47,0.03)] md:p-7">
            <div className="flex h-[88px] w-[88px] items-center justify-center rounded-[20px] border border-[#e7dfd8] bg-white shadow-[0_6px_16px_rgba(43,45,47,0.03)]">
              <img
                src="/images/metodo-logo.png"
                alt="MeToDo logo"
                className="h-[58px] w-auto object-contain"
              />
            </div>

            <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#017A92]">
              MeToDo Control
            </p>

            <h1 className="mt-3 text-3xl tracking-tight text-[#2B2D2F] md:text-4xl">
              Accesso area riservata
            </h1>

            <p className="mt-3 max-w-sm text-sm leading-7 text-[#555555]">
              Entra nel sistema per gestire attività, controllo operativo e lettura
              strategica dei moduli MeToDo Control.
            </p>

            <div className="mt-6 rounded-[18px] border border-[#ebe4dc] bg-white px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#017A92]">
                Accesso dedicato
              </p>
              <p className="mt-2 text-sm font-semibold text-[#2B2D2F]">
                Team MeToDo e utenti autorizzati
              </p>
            </div>
          </div>

          {/* RIGHT PANEL */}
          <div className="rounded-[24px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)] md:p-8">
            <div className="mx-auto max-w-xl">
              
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#017A92]">
                Login
              </p>

              <h2 className="mt-3 text-3xl tracking-tight text-[#2B2D2F] md:text-4xl">
                Bentornato
              </h2>

              <p className="mt-3 text-sm leading-7 text-[#555555]">
                Inserisci le tue credenziali per accedere alla piattaforma.
              </p>

              <form className="mt-8 space-y-4" onSubmit={handleLogin}>
                
                {/* EMAIL */}
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#555555]">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="nome@yourmetodo.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8a8178] focus:border-[#017A92] focus:bg-white"
                    required
                  />
                </div>

                {/* PASSWORD + OCCHIOLINO */}
                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <label className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#555555]">
                      Password
                    </label>

                    <button
                      type="button"
                      className="text-sm font-medium text-[#017A92] transition hover:opacity-80"
                    >
                      Password dimenticata?
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder="Inserisci password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 pr-12 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8a8178] focus:border-[#017A92] focus:bg-white"
                      required
                    />

                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#555555] hover:text-[#017A92]"
                    >
                      {showPassword ? "🙈" : "👁️"}
                    </button>
                  </div>
                </div>

                {/* REMEMBER */}
                <div className="flex items-center justify-between rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] px-4 py-3">
                  <label className="flex items-center gap-3 text-sm text-[#555555]">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="h-4 w-4 rounded border-[#d8cec5] accent-[#017A92]"
                    />
                    Ricordami
                  </label>

                  <span className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#017A92]">
                    Secure access
                  </span>
                </div>

                {/* ERROR */}
                {errorMessage && (
                  <div className="rounded-[14px] border border-[#ead8d8] bg-[#fff5f5] px-4 py-3 text-sm text-[#993333]">
                    {errorMessage}
                  </div>
                )}

                {/* BUTTON */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-[14px] bg-[#017A92] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(1,122,146,0.18)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {loading ? "Accesso in corso..." : "Accedi a MeToDo Control"}
                </button>
              </form>

              <p className="mt-5 text-xs leading-6 text-[#77706a]">
                Accesso riservato agli utenti autorizzati. Le funzionalità disponibili
                dipendono dal profilo assegnato.
              </p>
            </div>
          </div>

        </section>
      </div>
    </main>
  );
}