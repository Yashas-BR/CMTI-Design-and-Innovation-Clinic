import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type RoleSectionPlaceholderCardProps = {
  sectionLabel: string;
  message: string;
};

function RoleSectionPlaceholderCard({
  sectionLabel,
  message,
}: RoleSectionPlaceholderCardProps) {
  return (
    <Card className="border-white/80 bg-white/85 shadow-md backdrop-blur">
      <CardHeader>
        <CardTitle>{sectionLabel}</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-slate-700">
        This section is currently a navigation placeholder and will be wired to
        real backend screens step by step.
      </CardContent>
    </Card>
  );
}

export default RoleSectionPlaceholderCard;
