export function SearchBar({
  label,
  onSearch,
}: {
  label: string;
  onSearch: (query: string) => void;
}) {
  return (
    <form
      className="work-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(String(new FormData(event.currentTarget).get('query') ?? ''));
      }}
    >
      <input type="search" aria-label={label} name="query" placeholder={label} maxLength={100} />
      <button type="submit">搜索</button>
    </form>
  );
}
