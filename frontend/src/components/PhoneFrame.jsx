export default function PhoneFrame({ children }) {
  return (
    <section className="phone-stage">
      <div className="phone-halo" />
      <div className="phone-shell">
        <div className="phone-notch" />
        <div className="phone-screen">{children}</div>
      </div>
    </section>
  );
}
