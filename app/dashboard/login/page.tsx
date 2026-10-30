import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { signSession, constantEq } from "@/lib/auth";

async function attemptLogin(formData: FormData) {
  "use server";
  const pw = String(formData.get("pw") ?? "");
  const expected = process.env.DASHBOARD_PASSWORD ?? "";

  // Fixed-time compare + a small sleep to blunt brute-force (middleware does the real work)
  const match = expected.length > 0 && constantEq(pw, expected);
  if (!match) {
    await new Promise((r) => setTimeout(r, 400));
    redirect("/dashboard/login?e=1");
  }

  const token = signSession();
  const jar = await cookies();
  jar.set("bb_dash", token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });
  redirect("/dashboard");
}

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  return (
    <main>
      <h1>Dashboard</h1>
      <p className="subtitle">Login</p>
      <div className="card">
        <form action={attemptLogin}>
          <div className="field">
            <label>Password</label>
            <input type="password" name="pw" autoFocus required />
          </div>
          {e && <p className="error">Incorrect password.</p>}
          <button className="primary" type="submit">
            Enter →
          </button>
        </form>
      </div>
      <p className="footer">Session cookie; expires in 24h.</p>
    </main>
  );
}
