package api

import (
	"etl-banks-ar/internal/api/handlers"
	"etl-banks-ar/internal/api/middleware"
	"etl-banks-ar/internal/services"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func SetupRouter(db *gorm.DB) *gin.Engine {
	router := gin.Default()

	// Middleware
	router.Use(middleware.CORSMiddleware())

	// Services
	userService := services.NewUserService(db)
	workspaceService := services.NewWorkspaceService(db)
	transactionService := services.NewTransactionService(db)
	uploadService := services.NewUploadService(db)
	categoryService := services.NewCategoryService(db)
	areaService := services.NewAreaService(db)
	recurringExpenseService := services.NewRecurringExpenseService(db)

	// Handlers
	authHandler := handlers.NewAuthHandler(userService)
	workspaceHandler := handlers.NewWorkspaceHandler(workspaceService)
	transactionHandler := handlers.NewTransactionHandler(transactionService)
	uploadHandler := handlers.NewUploadHandler(uploadService)
	categoryHandler := handlers.NewCategoryHandler(categoryService)
	areaHandler := handlers.NewAreaHandler(areaService, categoryService)
	recurringExpenseHandler := handlers.NewRecurringExpenseHandler(recurringExpenseService)

	// API v1
	v1 := router.Group("/api/v1")
	{
		// Public routes
		auth := v1.Group("/auth")
		{
			auth.POST("/register", authHandler.Register)
			auth.POST("/login", authHandler.Login)
		}

		// Protected routes
		protected := v1.Group("")
		protected.Use(middleware.AuthMiddleware())
		{
			// Auth
			protected.GET("/auth/me", authHandler.Me)

			// Workspaces
			workspaces := protected.Group("/workspaces")
			{
				workspaces.GET("", workspaceHandler.List)
				workspaces.POST("", workspaceHandler.Create)
				workspaces.POST("/join/:token", workspaceHandler.JoinByToken)

				// Workspace-specific routes (using :id for all workspace operations)
				workspace := workspaces.Group("/:id")
				workspace.Use(middleware.WorkspaceAccessMiddleware(workspaceService))
				{
					workspace.GET("", workspaceHandler.Get)
					workspace.GET("/members", workspaceHandler.GetMembers)
					workspace.POST("/invite", workspaceHandler.CreateInvite)
					workspace.DELETE("/members/:user_id", workspaceHandler.RemoveMember)

					// Transactions
					workspace.GET("/transactions", transactionHandler.List)
					workspace.POST("/transactions", transactionHandler.Create)
					workspace.GET("/transactions/summary", transactionHandler.GetSummary)
					workspace.GET("/transactions/yearly-summary", transactionHandler.GetYearlySummary)
					workspace.POST("/transactions/upload", uploadHandler.Upload)
					workspace.POST("/transactions/confirm", uploadHandler.Confirm)
					workspace.GET("/transactions/:txn_id", transactionHandler.Get)
					workspace.PUT("/transactions/:txn_id", transactionHandler.Update)
					workspace.DELETE("/transactions/:txn_id", transactionHandler.Delete)

					// Owners
					workspace.GET("/owners", transactionHandler.GetOwners)

					// Categories CRUD
					workspace.GET("/categories", categoryHandler.List)
					workspace.POST("/categories", categoryHandler.Create)
					workspace.GET("/categories/:cat_id", categoryHandler.Get)
					workspace.PUT("/categories/:cat_id", categoryHandler.Update)
					workspace.DELETE("/categories/:cat_id", categoryHandler.Delete)

					// Areas CRUD
					workspace.GET("/areas", areaHandler.List)
					workspace.POST("/areas", areaHandler.Create)
					workspace.GET("/areas/summary", areaHandler.GetSummary)
					workspace.GET("/areas/:area_id", areaHandler.Get)
					workspace.PUT("/areas/:area_id", areaHandler.Update)
					workspace.DELETE("/areas/:area_id", areaHandler.Delete)
					workspace.GET("/areas/:area_id/categories", areaHandler.GetCategories)

					// Recurring Expenses CRUD
					workspace.GET("/recurring-expenses", recurringExpenseHandler.List)
					workspace.GET("/recurring-expenses/summary", recurringExpenseHandler.GetSummary)
					workspace.POST("/recurring-expenses", recurringExpenseHandler.Create)
					workspace.GET("/recurring-expenses/:re_id", recurringExpenseHandler.Get)
					workspace.PUT("/recurring-expenses/:re_id", recurringExpenseHandler.Update)
					workspace.DELETE("/recurring-expenses/:re_id", recurringExpenseHandler.Delete)
					workspace.POST("/recurring-expenses/:re_id/mark-paid", recurringExpenseHandler.MarkPaid)
				}
			}
		}
	}

	return router
}
