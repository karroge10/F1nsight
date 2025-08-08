import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ProPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Upgrade to Pro</CardTitle>
          <CardDescription>Unlock full predictions, deeper analytics, and premium insights.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <ul className="list-disc pl-5">
            <li>Race winner probabilities with confidence and historical trends</li>
            <li>Podium finish probabilities for all drivers</li>
            <li>Tyre strategy recommendations and weather impact</li>
            <li>Ad-free experience and early feature access</li>
          </ul>
          <div className="pt-2">
            <Button size="lg">Start 7‑day free trial</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


