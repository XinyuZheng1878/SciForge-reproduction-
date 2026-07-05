#!/bin/bash
# GitStudy 代码统计实验
PROJECT_DIR="/Users/zhengxinyu/projects/GitStudy"

echo "=========================================="
echo " GitStudy 代码结构统计报告"
echo "=========================================="

echo ""
echo "--- 1. 整体文件统计 ---"
echo "前端源文件（src/）:"
find "$PROJECT_DIR/src" -name "*.jsx" -o -name "*.js" -o -name "*.css" | grep -v node_modules | wc -l | xargs -I{} echo "  总文件数: {}"

echo ""
echo "后端源文件（server/）:"
find "$PROJECT_DIR/server" -name "*.js" | grep -v node_modules | wc -l | xargs -I{} echo "  总文件数: {}"

echo ""
echo "--- 2. 按目录文件数 TOP 10 ---"
find "$PROJECT_DIR/src" -type f \( -name "*.jsx" -o -name "*.js" -o -name "*.css" \) | grep -v node_modules | sed "s|$PROJECT_DIR/src/||" | xargs -I{} dirname {} | sort | uniq -c | sort -rn | head -15

echo ""
echo "--- 3. 代码行数统计 ---"
echo "前端 JSX/JS:"
find "$PROJECT_DIR/src" \( -name "*.jsx" -o -name "*.js" \) -not -path "*/node_modules/*" | xargs wc -l 2>/dev/null | tail -1

echo "前端 CSS:"
find "$PROJECT_DIR/src" -name "*.css" -not -path "*/node_modules/*" | xargs wc -l 2>/dev/null | tail -1

echo "后端 JS:"
find "$PROJECT_DIR/server" -name "*.js" -not -path "*/node_modules/*" | xargs wc -l 2>/dev/null | tail -1

echo ""
echo "--- 4. 前端依赖分析（package.json 分类）---"
echo "运行时依赖（含前端+后端）:"
node -e "const p=require('$PROJECT_DIR/package.json'); const d=Object.keys(p.dependencies); console.log('  总计: '+d.length+' 个'); const ui=d.filter(x=>/react|three|monaco|postprocessing|lucide|mermaid|katex|highlight/.test(x)); console.log('  前端 UI/可视化: '+ui.length+' 个 ('+ui.join(', ')+')'); const ai=d.filter(x=>/@tensorflow/.test(x)); console.log('  AI/ML: '+ai.length+' 个 ('+ai.join(', ')+')'); const svr=d.filter(x=>/express|cors|bcrypt|jsonwebtoken|nodemailer/.test(x)); console.log('  后端服务: '+svr.length+' 个 ('+svr.join(', ')+')');"

echo ""
echo "--- 5. API 路由统计 ---"
echo "后端 API 路由:"
grep -rn "router\.\(get\|post\|put\|delete\)" "$PROJECT_DIR/server/routes/" 2>/dev/null | grep -oP "(get|post|put|delete)\s*\(\s*['\"][^'\"]+['\"]" | sed 's/)/)/' | sort | head -30

echo ""
echo "--- 6. 前端组件分类统计 ---"
echo "article 相关组件:"
find "$PROJECT_DIR/src/components/article" -type f -name "*.jsx" | wc -l | xargs -I{} echo "  {} 个"
echo "lab 相关组件:"
find "$PROJECT_DIR/src/components/lab" -type f -name "*.jsx" | wc -l | xargs -I{} echo "  {} 个"
echo "其他顶层组件:"
find "$PROJECT_DIR/src/components" -maxdepth 1 -name "*.jsx" | wc -l | xargs -I{} echo "  {} 个"
echo "hooks 文件:"
find "$PROJECT_DIR/src/hooks" -name "*.js" | wc -l | xargs -I{} echo "  {} 个"
echo "样式文件:"
find "$PROJECT_DIR/src/styles" -name "*.css" | wc -l | xargs -I{} echo "  {} 个"