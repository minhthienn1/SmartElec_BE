Đăng nhập
Tổng quan các bước cần thực hiện để đăng nhập
•	Tạo code verifier và code challenge
•	Đăng nhập Zalo và lấy được OauthCode. Vì mặc định thì oauthCode chỉ có hiệu lực chỉ trong 10 phút, nên ngay sau khi có được oauthCode thì cần thực hiện lấy AccessToken và RefreshToken ngay.
•	Dùng OauthCode để lấy AccessToken và RefreshToken:
o	AccessToken: dùng để gọi các Official Account API Hiệu lực: mặc định là 1 giờ, server sẽ trả về thời gian expired khi gọi API get AccessToken.
o	RefreshToken: lưu lại RefreshToken ở phía app để kiểm tra đã đăng nhập hay chưa, và sử dụng để tạo lại AccessToken khi AccessToken hết hiệu lực. Hiệu lực: mặc định là 3 tháng
Tạo code verifier và code challenge
Zalo sử dụng code challenge và code verifier (theo phương thức PKCE) để tăng độ bảo mật của quá trình xác thực và ủy quyền. Xem thêm về PKCE tại đây. Sau khi cấu hình Đăng nhập, bạn cần:
•	Tạo một code verifier và lưu trữ trên hệ thống của bạn.
•	Dùng mã hóa code verifier bằng bộ ký tự ASCII, tiếp đến dùng giải thuật SHA-256 để tạo mã băm, sau cùng encode Base64 mã băm để tạo ra code challenge từ code verifier.
•	code_challenge = Base64.encode(SHA-256.hash(ASCII(code_verifier)))
Lưu ý: 
•	Yêu cầu sử dụng code verifier khác nhau cho từng request.
•	Code verifier là 1 chuỗi bất kỳ, format có đủ chữ hoa, chữ thường, số và dài 43 ký tự.
•	Code verifier là code dùng để xác minh quyền sở hữu của bạn với authorization code bạn nhận được từ hệ thống. Vui lòng không cung cấp code này cho bên thứ ba.
Bước 1: Gọi API authenticate
Có 2 cách gọi:
ZaloSDK.Instance.authenticateZaloWithAuthenType (Activity, LoginVia loginVia, String codeChallenge, OAuthCompleteListener) //default extInfo null
ZaloSDK.Instance.authenticateZaloWithAuthenType (Activity, LoginVia loginVia, String codeChallenge, JSONObject extInfo, OAuthCompleteListener)
Trong đó:
•	LoginVia có 3 tùy chọn đăng nhập:
Enum	Định nghĩa
APP	Đăng nhập bằng Zalo App
WEB	Đăng nhập bằng Webview
APP_OR_WEB	Đăng nhập bằng Zalo App, nếu máy không cài Zalo app sẽ dùng Webview
•	codeChallenge: cách tạo tham khảo tại (đây)
•	extInfo: (optional) thông tin bổ sung app muốn truyền thêm
•	OauthCompleteListener để nhận kết quả đăng nhập:
OAuthCompleteListener listener = new OAuthCompleteListener() {
    @Override
    public void onAuthenError(ErrorResponse errorResponse) {
        //Đăng nhập thất bại..
    }

    @Override
    public void onGetOAuthComplete(OauthResponse response) {
        String code = response.getOauthCode()
            //Đăng nhập thành công..
    }
};

Bước 2: Override onActivityResult của activity login
@Override
protected void onActivityResult(int reqCode, int resCode, Intent d) {
   super.onActivityResult(requestCode, resultCode, data);
   ZaloSDK.Instance.onActivityResult(this, reqCode, resCode, d);
}

Lấy Access Token
Ở V4 SDK sẽ cung cấp 2 api để app lấy access token sau khi đã login
Lấy bằng Oauth Code: App dùng oauthCode SDK trả về ở bước Login
ZaloSDK.Instance.getAccessTokenByOAuthCode( Context ctx,String oacode, String codeVerifier, new ZaloOpenAPICallback() {
    @Override
    public void onResult(JSONObject data) {
        int err = data.optInt("error");
        if (err == 0) {
            //clearOauthCodeInfo(); //clear used oacode

            access_token = data.optString("access_token");
            refresh_token = data.optString("refresh_token");
            long expires_in = Long.parseLong(data.optString("expires_in"));

            //Store data token in app cache
            ....  
        }
    }
});

Tham số:
•	ctx: application context
•	oacode: code sau khi login
•	codeVerifier: code app tự gen. Tham khảo tại đây
•	callback: override method onResult để nhận json trả về.
Data trả về:
•	access_token: token để gọi api.
•	refresh_token: token để làm mới access_token. Thời gian 3 tháng. Sau khi hết hiệu lực, đi lại flow login mới. Xác minh refresh token bằng api tại đây
•	expires_in: thời gian hiệu lực của access_token (default 3600s)
Lưu ý: cần lưu lại Refresh Token để lấy lại AccessToken sau khi AccessToken hết hạn. Lấy bằng Refresh Token:
ZaloSDK.Instance.getAccessTokenByRefreshToken(Context ctx,String refresh_token, new ZaloOpenAPICallback() {
    @Override
    public void onResult(JSONObject data) {
        int err = data.optInt("error");
        if (err == 0) {
            access_token = data.optString("access_token");
            refresh_token = data.optString("refresh_token");
            long expires_in = Long.parseLong(data.optString("expires_in"));

            //Update new data token in app cache
            ....  
        }
    }
});

Tham số:
•	ctx: application context
•	refreshToken: token lấy từ app cache.
•	callback: override method onResult để nhận json trả về.
Lưu ý: RefreshToken chỉ sử dụng để lấy AccessToken được một lần duy nhất. Sau khi lấy AccessToken xong thì cần lưu lại RefreshToken mới được trả về kèm với AccessToken.
Xác minh lại Refresh Token
SDK cung cấp method để kiểm tra refresh token còn hiệu lực:
ZaloSDK.Instance.isAuthenticate(refreshToken, new ValidateCallback() {

    @Override
    public void onValidateComplete(boolean validated, int errorCode, OauthResponse oauthResponse) {
        if (validated) {
            // refreshToken còn hiệu lực...
            long expireTime = oauthResponse.getExpireTime();
        }

    }
});

Lưu ý: ZaloSDK không hỗ trợ việc lưu lại session đăng nhập mà phía app sẽ tự quản lí việc này. Có thể sử dụng RefreshToken để xác minh session đăng nhập có đang còn hiệu lực hay không.
Đăng xuất
Khi đăng xuất, các thông tin đăng nhập cơ bản như login channel, displayname sẽ bị xóa: (oauth code, token , và userId app sẽ tự quản lý)
ZaloSDK.Instance.unauthenticate();
Lấy thông tin profile
SDK cung cấp API để lấy thông tin người dùng sau khi đăng nhập thành công:
ZaloSDK.Instance.getProfile(
  Context ctx,String access_token, ZaloOpenAPICallback callback, String[] fields)

Tham số:
•	ctx: application context
•	access_token:  được lấy ở mục (link)
•	callback: override method onResult để nhận json trả về từ open api. Ví dụ:
{
    "id": "UserId",
    "name": "User Name",
    "picture": {
        "data": {
            "url": "User avatar url"
        }
    }
}

•	fields : id, picture, name

