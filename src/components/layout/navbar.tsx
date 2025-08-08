"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LightningBoltIcon } from "@radix-ui/react-icons";
import { NavigationMenu, NavigationMenuItem, NavigationMenuLink, NavigationMenuList } from "@/components/ui/navigation-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/drivers", label: "Drivers" },
  { href: "/teams", label: "Teams" },
  { href: "/races", label: "Races" },
  { href: "/standings", label: "Standings" },
];

export function Navbar() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/70 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2">
          <LightningBoltIcon className="h-5 w-5 text-primary" />
          <span className="font-semibold">F1 Analytics</span>
        </Link>
        <NavigationMenu className="hidden md:block">
          <NavigationMenuList>
            {links.map((l) => (
              <NavigationMenuItem key={l.href}>
                <NavigationMenuLink asChild>
                  <Link
                    href={l.href}
                    className={cn(
                      "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:text-primary",
                      pathname === l.href ? "text-primary" : "text-muted-foreground"
                    )}
                  >
                    {l.label}
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>
            ))}
          </NavigationMenuList>
        </NavigationMenu>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/auth/sign-in">Sign In</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/pro">Upgrade to Pro</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}


