import { useEffect, useState } from 'react';
import Checker from './Checker.jsx';
import Impact from './Impact.jsx';
import About from './About.jsx';

const PAGES = { check: ['Check an offer', Checker], impact: ['Impact', Impact], about: ['About', About] };
const current = () => (PAGES[location.hash.slice(1)] ? location.hash.slice(1) : 'check');

export default function App() {
  const [page, setPage] = useState(current());
  useEffect(() => {
    const onHash = () => setPage(current());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);
  const Page = PAGES[page][1];
  return (
    <>
      <header className="top">
        <a className="brand" href="#check">InternSafe</a>
        <nav aria-label="Main">
          {Object.entries(PAGES).map(([id, [label]]) => (
            <a key={id} href={'#' + id} aria-current={page === id ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
      </header>
      <main><Page /></main>
      <footer>This tool gives guidance, not a guarantee. Always verify with the official company.</footer>
    </>
  );
}
