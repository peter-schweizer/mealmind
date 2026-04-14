import { NavLink } from 'react-router-dom'
import {
  Compass,
  BookOpen,
  Calendar,
  ShoppingCart,
  User,
  Globe,
  Leaf,
} from 'lucide-react'

interface NavItem {
  to: string
  icon: React.ReactNode
  label: string
}

const navItems: NavItem[] = [
  { to: '/discover', icon: <Compass size={20} />, label: 'Entdecken' },
  { to: '/my-recipes', icon: <BookOpen size={20} />, label: 'Mein Rezeptbuch' },
  { to: '/planner', icon: <Calendar size={20} />, label: 'Wochenplaner' },
  { to: '/shopping', icon: <ShoppingCart size={20} />, label: 'Einkaufsliste' },
  { to: '/profile', icon: <User size={20} />, label: 'Profil' },
  { to: '/sources', icon: <Globe size={20} />, label: 'Rezeptquellen' },
]

export default function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-screen w-64 bg-primary flex flex-col z-40 overflow-hidden">
      {/* Logo */}
      <div className="px-6 pt-8 pb-6 border-b border-primary-light/30">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-accent rounded-lg flex items-center justify-center flex-shrink-0 shadow-md">
            <Leaf size={18} className="text-white" />
          </div>
          <span
            className="text-2xl text-white leading-none tracking-tight"
            style={{ fontFamily: '"Playfair Display", Georgia, serif' }}
          >
            MealMind
          </span>
        </div>
        <p className="text-xs text-white/40 mt-2.5 ml-0.5 font-light tracking-wide">
          Smarter essen, besser leben
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-5 overflow-y-auto sidebar-scroll">
        <ul className="space-y-1">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  [
                    'flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-white/15 text-white shadow-sm'
                      : 'text-white/60 hover:text-white/90 hover:bg-white/8',
                  ].join(' ')
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={
                        isActive ? 'text-sand' : 'text-white/50'
                      }
                    >
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                    {isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Bottom section */}
      <div className="px-6 py-5 border-t border-primary-light/20">
        <div className="text-xs text-white/30 leading-relaxed">
          <p className="font-medium text-white/40 mb-1">MealMind v1.0</p>
          <p>Ihr persönlicher Küchenassistent</p>
        </div>
      </div>
    </aside>
  )
}
