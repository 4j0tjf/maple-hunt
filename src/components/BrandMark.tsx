/** 사이트 이름 옆의 단풍잎. 시세 사이트(maple-market)의 BrandMark와 같은 모양이다. */
export function BrandMark({ className = "size-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`${className} fill-accent`}>
      <path d="M12 1.5 13.6 4.9 15.6 3.9 15.1 8.6 18.9 5.6 19.3 7.6 22.2 7.1 21.1 10.4 22.6 11.3 17.6 15.4 18.3 17.1 12.9 16.4 13.2 22.5 10.8 22.5 11.1 16.4 5.7 17.1 6.4 15.4 1.4 11.3 2.9 10.4 1.8 7.1 4.7 7.6 5.1 5.6 8.9 8.6 8.4 3.9 10.4 4.9Z" />
    </svg>
  );
}
