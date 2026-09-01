import { LoadingState } from "@/components/ui/async-state";

export default function CategoriesLoading() {
  return <LoadingState label="Carregando categorias…" testId="categories-loading" />;
}
