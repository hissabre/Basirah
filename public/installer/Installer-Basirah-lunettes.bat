@echo off
chcp 65001 >nul
title Basirah - installation sur les lunettes INMO Air 2
setlocal
set "W=%TEMP%\basirah-install"
set "APK_URL=https://hissabre.github.io/Basirah/basirah-glasses.apk"
set "PT_URL=https://dl.google.com/android/repository/platform-tools-latest-windows.zip"
if not exist "%W%" mkdir "%W%"
cd /d "%W%"

echo.
echo  ============================================================
echo    BASIRAH - installation sur les lunettes INMO Air 2
echo  ============================================================
echo.
echo  Avant de continuer :
echo   1. Mode developpeur active sur les lunettes
echo      (Reglages ^> A propos ^> My Glasses, 2 appuis longs sur le pave droit, code 20210108)
echo   2. Lunettes allumees et branchees a cet ordinateur avec le cable USB
echo.
pause

echo.
echo  [1/4] Outils Android (Google)...
if not exist "%W%\platform-tools\adb.exe" (
  curl.exe -L --fail -s -S -o "%W%\pt.zip" "%PT_URL%" || goto :neterr
  tar -xf "%W%\pt.zip" -C "%W%" || powershell -NoProfile -Command "Expand-Archive -Force '%W%\pt.zip' '%W%'" || goto :fail
)
set "ADB=%W%\platform-tools\adb.exe"

echo  [2/4] Telechargement de Basirah (environ 36 Mo)...
curl.exe -L --fail -s -S -o "%W%\basirah-glasses.apk" "%APK_URL%" || goto :neterr

echo  [3/4] Recherche des lunettes...
"%ADB%" start-server >nul 2>&1
echo        Si les lunettes demandent "Autoriser le debogage USB ?", choisissez Autoriser.
set /a N=0
:wait
"%ADB%" get-state 2>nul | find "device" >nul && goto :found
set /a N+=1
if %N% GEQ 60 goto :nodev
timeout /t 2 /nobreak >nul
goto :wait

:found
echo  [4/4] Installation sur les lunettes...
"%ADB%" install -r "%W%\basirah-glasses.apk" > "%W%\install.log" 2>&1
find "Success" "%W%\install.log" >nul && goto :ok
findstr /i "INSTALL_FAILED_UPDATE_INCOMPATIBLE signatures" "%W%\install.log" >nul && (
  "%ADB%" uninstall app.basirah.glasses >nul 2>&1
  "%ADB%" install "%W%\basirah-glasses.apk" > "%W%\install.log" 2>&1
  find "Success" "%W%\install.log" >nul && goto :ok
)
type "%W%\install.log"
goto :fail

:ok
"%ADB%" shell pm grant app.basirah.glasses android.permission.RECORD_AUDIO >nul 2>&1
"%ADB%" shell monkey -p app.basirah.glasses -c android.intent.category.LAUNCHER 1 >nul 2>&1
echo.
echo  ============================================================
echo    Basirah est installe et ouvert sur les lunettes.
echo    Vous pouvez debrancher le cable.
echo  ============================================================
echo.
pause
exit /b 0

:nodev
echo.
echo  Les lunettes ne sont pas detectees.
echo   - Verifiez le cable USB (un cable qui transmet les donnees, pas seulement la charge)
echo   - Verifiez que le mode developpeur est bien active
echo   - Regardez si les lunettes affichent une demande d'autorisation
echo  Puis relancez ce fichier.
"%ADB%" devices
pause
exit /b 1

:neterr
echo.
echo  Pas d'acces a Internet (ou telechargement bloque). Verifiez la connexion et relancez.
pause
exit /b 1

:fail
echo.
echo  L'installation a echoue. Faites une capture de cette fenetre et envoyez-la.
pause
exit /b 1
