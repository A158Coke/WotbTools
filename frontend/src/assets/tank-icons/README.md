# 战局回放坦克图标

项目自制的俯视 SVG 图标，供 AI Review「战局回放」使用：

- `light-tank.svg`：轻坦
- `medium-tank.svg`：中坦
- `heavy-tank.svg`：重坦
- `tank-destroyer.svg`：坦克歼击车

约定：

- 统一 `viewBox="0 0 32 40"`，车头朝上。
- 图形使用 `currentColor`，推荐以内联 SVG 或 CSS mask 使用，由阵营色板控制颜色。
- 图标只表达车型，不对应具体车辆外观。
- 无障碍名称与车辆状态由消费组件提供；地图上的装饰性实例应设置 `aria-hidden="true"`。
