export default function Done() {
  return (
    <main>
      <div className="success-screen">
        <h1>Thank you.</h1>
        <p>
          Your ratings are saved. You've just helped validate the automated judge used in
          BurnettBench Study 2 — a study of the <code>llms.txt</code> standard.
        </p>
        <p style={{ marginTop: 20 }}>
          If you have thoughts on specific items (ambiguous probes, edge cases, categories we missed),
          please email <strong>h.niyorurema@tcu.edu</strong>.
        </p>
        <p style={{ marginTop: 30, fontSize: 13 }}>
          You can close this tab.
        </p>
      </div>
    </main>
  );
}
