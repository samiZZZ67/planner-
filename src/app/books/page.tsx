import { redirect } from 'next/navigation';

export const instant = false;

export default async function BooksRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const queryString = new URLSearchParams();
  queryString.set('tab', 'books');

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        queryString.set(key, value);
      } else if (Array.isArray(value)) {
        value.forEach(v => queryString.append(key, v));
      }
    }
  }

  redirect(`/?${queryString.toString()}`);
}
