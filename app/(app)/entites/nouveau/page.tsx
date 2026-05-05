import { PageHeader } from "@/components/page-header";
import { EntityForm } from "../entity-form";

export default function NewEntityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Entités" title="Nouvelle entité" />
      <EntityForm
        mode="create"
        defaultValues={{
          name: "",
          kind: "prospect",
          website: "",
          siren: "",
          vatNumber: "",
          address: {},
          notes: "",
        }}
      />
    </div>
  );
}
