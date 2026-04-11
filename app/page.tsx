"use client";

import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-[#f5f3ef] px-6 py-8 text-[#2B2D2F] md:px-10">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-7xl items-center">
        <section className="grid w-full overflow-hidden rounded-[24px] border border-[#e7dfd8] bg-white shadow-[0_12px_30px_rgba(43,45,47,0.05)] lg:grid-cols-[420px_1fr]">
          
          {/* BLOCCO SINISTRA */}
          <div className="flex flex-col justify-between bg-gradient-to-br from-[#2B2D2F] to-[#343739] p-8 text-white md:p-10">
            <div>
              <div className="flex h-[172px] w-[172px] items-center justify-center rounded-[20px] bg-white shadow-[0_12px_30px_rgba(43,45,47,0.12)]">
                <img
                  src="/images/metodo-logo.png"
                  alt="MeToDo logo"
                  className="h-[140px] w-auto object-contain"
                />
              </div>

              <p className="mt-8 text-xs font-semibold uppercase tracking-[0.28em] text-[#7fd0de]">
                MeToDo Control
              </p>

              <h1 className="mt-4 text-4xl leading-tight tracking-tight md:text-5xl">
                Accesso area riservata
              </h1>

              <p className="mt-4 max-w-md text-[15px] leading-7 text-white/75">
                Controllo operativo e strategico con visione chiara su task, tempo e performance.
              </p>
            </div>

            <div className="mt-10 rounded-[20px] border border-white/10 bg-white/5 px-5 py-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#7fd0de]">
                Accesso dedicato
              </p>
              <p className="mt-3 text-lg font-semibold">
                Team MeToDo e utenti autorizzati
              </p>
            </div>
          </div>

          {/* BLOCCO LOGIN */}
          <div className="p-8 md:p-10 lg:p-12">
            <div className="mx-auto max-w-xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#017A92]">
                Login
              </p>

              <h2 className="mt-3 text-4xl tracking-tight">
                Bentornato
              </h2>

              <p className="mt-4 text-[16px] leading-8 text-[#555555]">
                Inserisci le tue credenziali per accedere alla piattaforma.
              </p>

              <form
                className="mt-10 space-y-5"
                onSubmit={(e) => {
                  e.preventDefault();
                  router.push("/dashboard");
                }}
              >
                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#555555]">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="nome@yourmetodo.com"
                    className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 outline-none focus:border-[#017A92] focus:bg-white"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-[#555555]">
                    Password
                  </label>
                  <input
                    type="password"
                    placeholder="Inserisci password"
                    className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 outline-none focus:border-[#017A92] focus:bg-white"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full rounded-[14px] bg-[#017A92] px-5 py-3 font-semibold text-white shadow-[0_12px_30px_rgba(1,122,146,0.18)] hover:opacity-95"
                >
                  Accedi a MeToDo Control
                </button>
              </form>

              <div className="mt-8 rounded-[20px] border border-[#e7dfd8] bg-[#fcfbf9] px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[#017A92]">
                  Nota
                </p>
                <p className="mt-3 text-sm text-[#555555]">
                  Accesso riservato agli utenti autorizzati.
                </p>
              </div>
            </div>
          </div>

        </section>
      </div>
    </main>
  );
}