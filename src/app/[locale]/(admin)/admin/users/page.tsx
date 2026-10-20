import { db } from "@/db";
import { users, creditPackages, videos } from "@/db/schema";
import { count, sql, desc, inArray } from "drizzle-orm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronLeft,
  ChevronRight,
  Search,
  Shield,
} from "@/components/ui/icons";
import { UserVideosButton } from "@/components/admin/users/user-videos-button";

interface UsersPageProps {
  searchParams: Promise<{
    page?: string;
    search?: string;
  }>;
}

export default async function UsersPage({ searchParams }: UsersPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const search = params.search || "";
  const limit = 20;
  const offset = (page - 1) * limit;

  // 获取用户总数（带搜索）
  let totalUsersResult;
  if (search) {
    totalUsersResult = await db
      .select({ count: count() })
      .from(users)
      .where(sql`${users.email} ILIKE ${`%${search}%`} OR ${users.name} ILIKE ${`%${search}%`}`);
  } else {
    totalUsersResult = await db.select({ count: count() }).from(users);
  }
  const totalUsers = totalUsersResult[0]?.count || 0;
  const totalPages = Math.ceil(totalUsers / limit);

  // 获取用户列表
  let usersList;
  if (search) {
    usersList = await db
      .select()
      .from(users)
      .where(sql`${users.email} ILIKE ${`%${search}%`} OR ${users.name} ILIKE ${`%${search}%`}`)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
  } else {
    usersList = await db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
  }

  // 批量聚合用户统计信息：消除 N+1。
  // 原实现对每个用户单独发 2 条 SQL（视频数 + 积分包），一页 20 个用户 = 1 + 20*2 = 41 次往返；
  // 改为用 IN (...) + GROUP BY 一次聚合当前页所有用户，仅需 2 条 SQL，数据库往返减少约 90%。
  // videos.user_id 命中 videos_user_id_idx，credit_packages.user_id 命中 credit_packages_user_id_status_idx。
  const userIds = usersList.map((u) => u.id);

  let videoCountMap = new Map<string, number>();
  let creditStatsMap = new Map<string, { count: number; total: number }>();

  if (userIds.length > 0) {
    const [videoCounts, creditStats] = await Promise.all([
      // 一条 SQL 批量统计每个用户的视频数
      db
        .select({ userId: videos.userId, count: count() })
        .from(videos)
        .where(inArray(videos.userId, userIds))
        .groupBy(videos.userId),

      // 一条 SQL 批量统计每个用户的积分包数量与可用积分合计
      db
        .select({
          userId: creditPackages.userId,
          count: count(),
          total: sql<number>`COALESCE(SUM(${creditPackages.remainingCredits}), 0)`,
        })
        .from(creditPackages)
        .where(inArray(creditPackages.userId, userIds))
        .groupBy(creditPackages.userId),
    ]);

    videoCountMap = new Map(videoCounts.map((r) => [r.userId, r.count]));
    creditStatsMap = new Map(
      creditStats.map((r) => [r.userId, { count: r.count, total: Number(r.total) }]),
    );
  }

  const usersWithStats = usersList.map((user) => {
    const pkg = creditStatsMap.get(user.id);
    return {
      ...user,
      videoCount: videoCountMap.get(user.id) || 0,
      packageCount: pkg?.count || 0,
      totalCredits: pkg?.total || 0,
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">用户管理</h1>
          <p className="text-muted-foreground">
            共 {totalUsers} 位用户
          </p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <CardContent className="pt-6">
          <form className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                name="search"
                placeholder="搜索邮箱或用户名..."
                defaultValue={search}
                className="pl-10"
              />
            </div>
            <Button type="submit">搜索</Button>
          </form>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>用户列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>用户</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>视频数</TableHead>
                  <TableHead>积分包</TableHead>
                  <TableHead>可用积分</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>注册时间</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {usersWithStats.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center">
                      暂无数据
                    </TableCell>
                  </TableRow>
                ) : (
                  usersWithStats.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-3">
                          {user.image ? (
                            <img
                              src={user.image}
                              alt={user.name || "User"}
                              className="h-8 w-8 rounded-full"
                            />
                          ) : (
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                              <span className="text-xs">
                                {(user.name || user.email || "?").charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <span className="max-w-[200px] truncate">
                            {user.name || "未设置"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>{user.videoCount}</TableCell>
                      <TableCell>{user.packageCount}</TableCell>
                      <TableCell>
                        <span className="font-medium">{user.totalCredits}</span>
                      </TableCell>
                      <TableCell>
                        {user.isAdmin ? (
                          <Badge variant="default" className="gap-1">
                            <Shield className="h-3 w-3" />
                            管理员
                          </Badge>
                        ) : (
                          <Badge variant="outline">普通用户</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                      </TableCell>
                      <TableCell>
                        <UserVideosButton
                          userId={user.id}
                          userName={user.name}
                          userEmail={user.email}
                          videoCount={user.videoCount}
                        />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-muted-foreground">
                第 {page} 页，共 {totalPages} 页
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  asChild={page > 1}
                  disabled={page <= 1}
                >
                  <a
                    href={`?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    上一页
                  </a>
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                >
                  <a
                    href={`?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
                  >
                    下一页
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </a>
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
