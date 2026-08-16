import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold text-primary-700">Rajahinta.fi</h1>
      <p className="mt-4 text-lg text-gray-600">
        Finnish cross-border beverage landed-cost calculator
      </p>
      <nav className="mt-8 flex flex-wrap items-center justify-center gap-4">
        <Link
          href="/calculator"
          className="inline-flex items-center rounded-md bg-primary-600 px-6 py-3 text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          Open calculator
        </Link>
        <Link
          href="/compare"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          Compare products
        </Link>
        <Link
          href="/ranking"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          How ranking works
        </Link>
        <Link
          href="/account"
          className="inline-flex items-center rounded-md border border-gray-300 bg-white px-6 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2"
        >
          My account
        </Link>
      </nav>
    </main>
  );
}