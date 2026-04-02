package services

import (
	"errors"

	"etl-banks-ar/internal/auth"
	"etl-banks-ar/internal/models"

	"gorm.io/gorm"
)

type UserService struct {
	db *gorm.DB
}

func NewUserService(db *gorm.DB) *UserService {
	return &UserService{db: db}
}

func (s *UserService) Create(email, password, name string) (*models.User, error) {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return nil, err
	}

	user := &models.User{
		Email:        email,
		PasswordHash: hash,
		Name:         name,
	}

	if err := s.db.Create(user).Error; err != nil {
		return nil, err
	}

	return user, nil
}

func (s *UserService) FindByEmail(email string) (*models.User, error) {
	var user models.User
	if err := s.db.Where("email = ?", email).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *UserService) FindByID(id uint) (*models.User, error) {
	var user models.User
	if err := s.db.First(&user, id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (s *UserService) Authenticate(email, password string) (*models.User, string, error) {
	user, err := s.FindByEmail(email)
	if err != nil {
		return nil, "", errors.New("invalid credentials")
	}

	if !auth.CheckPassword(password, user.PasswordHash) {
		return nil, "", errors.New("invalid credentials")
	}

	token, err := auth.GenerateToken(user.ID, user.Email)
	if err != nil {
		return nil, "", err
	}

	return user, token, nil
}
