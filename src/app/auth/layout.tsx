export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center p-4 lg:p-8">
      {children}
    </div>
  );
}
