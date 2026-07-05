#!/bin/bash
PROJECT_DIR="/Users/zhengxinyu/projects/GitStudy"

echo "=========================================="
echo " GitStudy 模块依赖深度分析"
echo "=========================================="

echo ""
echo "--- 1. server/lib 模块清单及导入分析 ---"
echo ""
for f in "$PROJECT_DIR/server/lib/"*.js; do
  name=$(basename "$f")
  imports=$(grep "^import " "$f" | grep -v "^import " | wc -l | tr -d ' ')
  # Count items from other lib modules
  cross_lib=$(grep "^import .*from ['\"]\.\." "$f" | grep "/lib/" | wc -l | tr -d ' ')
  # Check what it imports from the project
  project_imports=$(grep "^import " "$f" | grep -oP "from ['\"](?:\.\.?/)*([^'\"/]+)" | tr '\n' ' ')
  echo "  $name"
  echo "    外部导入数: $cross_lib"
  if [ -n "$project_imports" ]; then
    echo "    项目内部导入: $project_imports"
  fi
done

echo ""
echo "lib 模块数: $(ls "$PROJECT_DIR/server/lib/"*.js 2>/dev/null | wc -l | tr -d ' ')"

echo ""
echo "--- 2. import 来源分析 ---"
echo "每个 lib 文件 import 了哪些项目内部模块:"
for f in "$PROJECT_DIR/server/lib/"*.js; do
  name=$(basename "$f")
  internal=$(grep "^import " "$f" | grep -oP "['\"](\.\.?/)+[^'\"]+" | grep -v node_modules | sort -u | tr '\n' ' ')
  if [ -n "$internal" ]; then
    echo "  $name -> $internal"
  fi
done

echo ""
echo "--- 3. 检查是否 lib 内有混合职责 ---"
mixed=0
for f in "$PROJECT_DIR/server/lib/"*.js; do
  name=$(basename "$f")
  has_db=$(grep -c "db\|Database\|database\|query\|insert\|select\|update\|delete" "$f" 2>/dev/null || echo 0)
  has_ai=$(grep -c "ai\|AI\|dashscope\|DashScope\|model\|Model" "$f" 2>/dev/null || echo 0)
  has_auth=$(grep -c "jwt\|JWT\|token\|Token\|bcrypt\|password\|Password\|auth\|Auth" "$f" 2>/dev/null || echo 0)
  
  if [ "$name" = "ai.js" ]; then
    if [ "$has_db" -gt 2 ]; then echo "  ⚠️  ai.js 包含数据库相关代码 ($has_db 处匹配)"; mixed=$((mixed+1)); fi
  elif [ "$name" = "auth.js" ]; then
    if [ "$has_ai" -gt 2 ]; then echo "  ⚠️  auth.js 包含 AI 相关代码 ($has_ai 处匹配)"; mixed=$((mixed+1)); fi
  elif [ "$name" = "db.js" ] || [ "$name" = "db-json.js" ] || [ "$name" = "db-memory.js" ]; then
    if [ "$has_ai" -gt 2 ]; then echo "  ⚠️  $name 包含 AI 相关代码 ($has_ai 处匹配)"; mixed=$((mixed+1)); fi
    if [ "$has_auth" -gt 2 ]; then echo "  ⚠️  $name 包含认证相关代码 ($has_auth 处匹配)"; mixed=$((mixed+1)); fi
  fi
done
echo "可能混合: $mixed 个"

echo ""
echo "--- 4. server/routes 文件及对应 lib 使用 ---"
for f in "$PROJECT_DIR/server/routes/"*.js; do
  name=$(basename "$f")
  libs_used=$(grep "^import .*from" "$f" | grep -oP "['\"]\.\./lib/[^'\"]+" | sed 's|../lib/||g' | sort -u | tr '\n' ' ')
  echo "  $name 使用了 lib: $libs_used"
done

echo ""
echo "--- 5. 前端组件分析 ---"
echo "article 子组件:"
ls "$PROJECT_DIR/src/components/article/"*.jsx "$PROJECT_DIR/src/components/article/blocks/"*.jsx 2>/dev/null | xargs -I{} basename {} | tr '\n' ' '
echo ""
echo "lab 子组件:"
ls "$PROJECT_DIR/src/components/lab/"*.jsx 2>/dev/null | xargs -I{} basename {} | tr '\n' ' '
echo ""
echo "hooks:"
ls "$PROJECT_DIR/src/hooks/"*.js 2>/dev/null | xargs -I{} basename {} | tr '\n' ' '
echo ""