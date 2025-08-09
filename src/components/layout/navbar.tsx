'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Menu, Zap, Users, Car, Trophy, Calendar, Brain, BarChart3, Crown, User, TrendingUp } from 'lucide-react'
import { useLoading } from '@/components/loading-provider'

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false)
  const pathname = usePathname()
  const { setLoading } = useLoading()

  const navigation = [
    { name: 'Dashboard', href: '/', icon: BarChart3 },
    { name: 'Drivers', href: '/drivers', icon: Users },
    { name: 'Teams', href: '/teams', icon: Car },
    { name: 'Races', href: '/races', icon: Calendar },
    { name: 'Standings', href: '/standings', icon: Trophy },
    { name: 'Analytics', href: '/analytics', icon: TrendingUp, premium: true },
    { name: 'Predictions', href: '/predictions', icon: Brain, premium: true },
  ]

  const handleNavClick = (href: string) => {
    if (href !== pathname) {
      setLoading(true)
      setIsOpen(false)
    }
  }

  return (
    <nav className="bg-gray-900 border-b border-gray-800 sticky top-0 z-50">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2">
            <div className="p-2 bg-gradient-to-r from-red-600 to-red-800 rounded-lg">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="text-xl font-bold text-white">F1 Analytics</div>
              <div className="text-xs text-red-400">Pro</div>
            </div>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center space-x-1">
            {navigation.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href
              return (
                <Link key={item.name} href={item.href} onClick={() => handleNavClick(item.href)}>
                  <Button 
                    variant="ghost" 
                    className={`flex items-center gap-2 transition-all duration-300 hover:scale-105 ${
                      isActive 
                        ? 'text-red-400 bg-red-500/10 border border-red-500/20' 
                        : 'text-gray-300 hover:text-white hover:bg-gray-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.name}
                    {item.premium && (
                      <Badge variant="secondary" className="bg-yellow-600 text-white text-xs animate-pulse">
                        Pro
                      </Badge>
                    )}
                  </Button>
                </Link>
              )
            })}
          </div>

          {/* User Actions */}
          <div className="hidden md:flex items-center gap-3">
            <Button variant="outline" className="border-gray-600 text-gray-300 hover:bg-gray-800">
              <User className="w-4 h-4 mr-2" />
              Sign In
            </Button>
            <Button className="bg-gradient-to-r from-red-600 to-red-800 hover:from-red-700 hover:to-red-900">
              <Crown className="w-4 h-4 mr-2" />
              Upgrade to Pro
            </Button>
          </div>

          {/* Mobile Menu */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden text-gray-300">
                <Menu className="w-6 h-6" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="bg-gray-900 border-gray-800">
              <div className="flex flex-col gap-4 mt-8">
                {navigation.map((item) => {
                  const Icon = item.icon
                  const isActive = pathname === item.href
                  return (
                    <Link 
                      key={item.name} 
                      href={item.href}
                      onClick={() => handleNavClick(item.href)}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-all duration-300 hover:scale-105 ${
                        isActive 
                          ? 'text-red-400 bg-red-500/10 border border-red-500/20' 
                          : 'text-gray-300 hover:text-white hover:bg-gray-800'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      {item.name}
                      {item.premium && (
                        <Badge variant="secondary" className="bg-yellow-600 text-white text-xs ml-auto animate-pulse">
                          Pro
                        </Badge>
                      )}
                    </Link>
                  )
                })}
                
                <div className="border-t border-gray-800 pt-4 mt-4">
                  <Button 
                    variant="outline" 
                    className="w-full mb-3 border-gray-600 text-gray-300 hover:bg-gray-800"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Sign In
                  </Button>
                  <Button className="w-full bg-gradient-to-r from-red-600 to-red-800">
                    <Crown className="w-4 h-4 mr-2" />
                    Upgrade to Pro
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  )
}


