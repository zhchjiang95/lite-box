import { Link } from 'react-router'
import { motion } from 'motion/react'
import { Compass } from 'lucide-react'
import { buttonClass } from '@/components/ui/button'
import { PageContainer } from '@/components/ToolGrid'

/** 404 */
export default function NotFound() {
  return (
    <PageContainer className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
        animate={{ scale: 1, opacity: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        className="text-gradient text-7xl font-black sm:text-8xl"
      >
        404
      </motion.div>
      <p className="text-muted-foreground mt-4">这个页面迷路了，工具可能已更名或尚未上线。</p>
      <Link to="/" viewTransition className={buttonClass({ variant: 'primary', className: 'mt-6' })}>
        <Compass />
        返回首页
      </Link>
    </PageContainer>
  )
}
