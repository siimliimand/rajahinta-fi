import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold text-primary-700">Rajahinta.fi</h1>
      <p className="mt-4 text-lg text-gray-600">
        Finnish cross-border beverage landed-cost calculator
      </p>
      <nav className="mt-8">
        <Link
          href="/calculator"
          className="inline-flex items-center rounded-md bg-primary-600 px-6 py-3 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          Open calculator
        </Link>
      </nav>
    </main>
  );
}