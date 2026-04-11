"use client";

import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  return (
    <main className="min-h-screen bg-[#f5f3ef] px-5 py-6 text-[#2B2D2F] md:px-8 md:py-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-6xl items-center">
        <section className="grid w-full gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
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

              <form
                className="mt-8 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  router.push("/dashboard");
                }}
              >
                <div>
                  <label className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-[#555555]">
                    Email
                  </label>
                  <input
                    type="email"
                    placeholder="nome@yourmetodo.com"
                    className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8a8178] focus:border-[#017A92] focus:bg-white"
                  />
                </div>

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

                  <input
                    type="password"
                    placeholder="Inserisci password"
                    className="w-full rounded-[14px] border border-[#e7dfd8] bg-[#fcfbf9] px-4 py-3 text-sm text-[#2B2D2F] outline-none transition placeholder:text-[#8a8178] focus:border-[#017A92] focus:bg-white"
                  />
                </div>

                <div className="flex items-center justify-between rounded-[18px] border border-[#ebe4dc] bg-[#fcfbf9] px-4 py-3">
                  <label className="flex items-center gap-3 text-sm text-[#555555]">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-[#d8cec5] accent-[#017A92]"
                    />
                    Ricordami
                  </label>

                  <span className="inline-flex rounded-full border border-[#dbe8eb] bg-[#f3f8fa] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#017A92]">
                    Secure access
                  </span>
                </div>

                <button
                  type="submit"
                  className="w-full rounded-[14px] bg-[#017A92] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(1,122,146,0.18)] transition hover:opacity-95"
                >
                  Accedi a MeToDo Control
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