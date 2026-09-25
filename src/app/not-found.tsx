import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

// The public header/footer used to wrap every 404 via the root layout. Now that
// the root layout is a bare document, this keeps the public 404 unchanged: the
// same chrome around a copy of Next.js's built-in 404 content.
const styles = {
  error: {
    fontFamily:
      'system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif,"Apple Color Emoji","Segoe UI Emoji"',
    height: "100vh",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  h1: {
    display: "inline-block",
    margin: "0 20px 0 0",
    padding: "0 23px 0 0",
    fontSize: 24,
    fontWeight: 500,
    verticalAlign: "top",
    lineHeight: "49px",
  },
  h2: { fontSize: 14, fontWeight: 400, lineHeight: "49px", margin: 0 },
} as const;

const css =
  "body{color:#000;background:#fff;margin:0}.next-error-h1{border-right:1px solid rgba(0,0,0,.3)}@media (prefers-color-scheme:dark){body{color:#fff;background:#000}.next-error-h1{border-right:1px solid rgba(255,255,255,.3)}}";

export default function NotFound() {
  return (
    <>
      <Header />
      <main className="flex-1">
        <title>404: This page could not be found.</title>
        <div style={styles.error}>
          <div>
            <style dangerouslySetInnerHTML={{ __html: css }} />
            <h1 className="next-error-h1" style={styles.h1}>
              404
            </h1>
            <div style={{ display: "inline-block" }}>
              <h2 style={styles.h2}>This page could not be found.</h2>
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
