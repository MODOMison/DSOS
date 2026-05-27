/**
 * Desktop wallpaper — the eclipse photograph itself, with a slight dim
 * overlay so windows stay readable on top.
 */
export function DesktopBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black">
      <img
        src="/eclipse.png"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        style={{ objectPosition: "center 60%" }}
      />
    </div>
  );
}
