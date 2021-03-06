﻿import { Injectable } from '@angular/core';
import { Http, Headers, RequestOptions, Response } from '@angular/http';
import { Observable } from 'rxjs/Observable';
import { BehaviorSubject } from 'rxjs/BehaviorSubject';
import 'rxjs/add/operator/map';
import 'rxjs/add/operator/catch';
import 'rxjs/add/observable/throw';
import 'rxjs/add/observable/interval';
import 'rxjs/add/observable/timer';

import { AuthHttp } from 'angular2-jwt';

import { Config } from '../config';

/**
 * ROPC Authentication service.
 */
@Injectable() export class AuthenticationService {

    /**
     * Stores the URL so we can redirect after signing in.
     */
    public redirectUrl: string;

    /**
     * Behavior subjects of the user's status, data & roles.
     * https://netbasal.com/angular-2-persist-your-login-status-with-behaviorsubject-45da9ec43243#.14rltx9dh
     */
    public signinSubject = new BehaviorSubject<boolean>(this.tokenNotExpired());

    public userSubject = new BehaviorSubject<any>({});

    public rolesSubject = new BehaviorSubject<string[]>([]);

    /**
     * Token info.
     */
    private expiresIn: number;
    private authTime: number;

    /**
     * Scheduling of the refresh token.
     */
    private refreshSubscription: any;
    /**
     * Offset for the scheduling to avoid the inconsistency of data on the client.
     */
    private offsetSeconds: number = 30;

    private headers: Headers;
    private options: RequestOptions;

    constructor(private http: Http, private authHttp: AuthHttp) {

        // On bootstrap or refresh, tries to get users'data.
        this.userInfo();

        // Creates header for post requests.
        this.headers = new Headers({ 'Content-Type': 'application/x-www-form-urlencoded' });
        this.options = new RequestOptions({ headers: this.headers });

    }

    /**
     * Tries to sign in the user.
     *
     * @param username
     * @param password
     * @return The user's data
     */
    public signin(username: string, password: string): Observable<any> {

        // Token endpoint & params.
        let tokenEndpoint: string = Config.TOKEN_ENDPOINT;

        let params: any = {
            client_id: Config.CLIENT_ID,
            grant_type: Config.GRANT_TYPE,
            username: username,
            password: password,
            scope: Config.SCOPE
        };

        // Encodes the parameters.
        let body: string = this.encodeParams(params);

        this.authTime = new Date().valueOf();

        return this.http.post(tokenEndpoint, body, this.options)
            .map((res: Response) => {

                let body: any = res.json();

                // Sign in successful if there's an access token in the response.
                if (typeof body.access_token !== 'undefined') {

                    // Stores access token & refresh token.
                    this.store(body);

                    // Gets user info.
                    this.userInfo();

                    // Tells all the subscribers about the new status.
                    this.signinSubject.next(true);

                }

            }).catch((error: any) => {

                // Error on post request.
                return Observable.throw(error);

            });

    }

    /**
     * Optional strategy for refresh token through a scheduler.
     *
     * Will schedule a refresh at the appropriate time.
     */
    public scheduleRefresh(): void {

        let source = this.authHttp.tokenStream.flatMap(
            (token: string) => {

                let delay: number = this.expiresIn - this.offsetSeconds * 1000;

                return Observable.interval(delay);

            });

        this.refreshSubscription = source.subscribe(() => {
            this.getNewToken().subscribe(
                () => {
                    // Scheduler works.
                },
                (error: any) => {
                    // Need to handle this error.
                    console.log(error);
                }
            );
        });

    }

    /**
     * Case when the user comes back to the app after closing it.
     */
    public startupTokenRefresh(): void {

        // If the user is authenticated, uses the token stream
        // provided by angular2-jwt and flatMap the token.
        if (this.signinSubject.getValue()) {

            let source = this.authHttp.tokenStream.flatMap(
                (token: string) => {
                    let now: number = new Date().valueOf();
                    let exp: number = Helpers.getExp();
                    let delay: number = exp - now - this.offsetSeconds * 1000;

                    // Uses the delay in a timer to run the refresh at the proper time. 
                    return Observable.timer(delay);
                });

            // Once the delay time from above is reached, gets a new JWT and schedules additional refreshes.
            source.subscribe(() => {
                this.getNewToken().subscribe(
                    () => {
                        this.scheduleRefresh();
                    },
                    (error: any) => {
                        // Need to handle this error.
                        console.log(error);
                    }
                );
            });

        }

    }

    /**
     * Unsubscribes from the scheduling of the refresh token.
     */
    public unscheduleRefresh(): void {

        if (this.refreshSubscription) {
            this.refreshSubscription.unsubscribe();
        }

    }

    /**
     * Tries to get a new token using refresh token.
     */
    public getNewToken(): Observable<any> {

        let refreshToken: string = Helpers.getToken('refresh_token');

        // Token endpoint & params.
        let tokenEndpoint: string = Config.TOKEN_ENDPOINT;

        let params: any = {
            client_id: Config.CLIENT_ID,
            grant_type: "refresh_token",
            refresh_token: refreshToken
        };

        // Encodes the parameters.
        let body: string = this.encodeParams(params);

        this.authTime = new Date().valueOf();

        return this.http.post(tokenEndpoint, body, this.options)
            .map((res: Response) => {

                let body: any = res.json();

                // Successful if there's an access token in the response.
                if (typeof body.access_token !== 'undefined') {

                    // Stores access token & refresh token.
                    this.store(body);

                }

            }).catch((error: any) => {

                // Error on post request.
                return Observable.throw(error);

            });

    }

    /**
     * Revokes token.
     */
    public revokeToken(): void {

        let token: string = Helpers.getToken('id_token');

        if (token != null) {

            // Revocation endpoint & params.
            let revocationEndpoint: string = Config.REVOCATION_ENDPOINT;

            let params: any = {
                client_id: Config.CLIENT_ID,
                token_type_hint: "access_token",
                token: token
            };

            // Encodes the parameters.
            let body: string = this.encodeParams(params);

            this.http.post(revocationEndpoint, body, this.options)
                .subscribe(
                () => {

                    Helpers.removeToken('id_token');
                    Helpers.removeExp();

                });

        }

    }

    /**
     * Revokes refresh token.
     */
    public revokeRefreshToken(): void {

        let refreshToken: string = Helpers.getToken('refresh_token');

        if (refreshToken != null) {

            // Revocation endpoint & params.
            let revocationEndpoint: string = Config.REVOCATION_ENDPOINT;

            let params: any = {
                client_id: Config.CLIENT_ID,
                token_type_hint: "refresh_token",
                token: refreshToken
            };

            // Encodes the parameters.
            let body: string = this.encodeParams(params);

            this.http.post(revocationEndpoint, body, this.options)
                .subscribe(
                () => {

                    Helpers.removeToken('refresh_token');

                });

        }

    }

    /**
     * Removes user and revokes tokens.
     */
    public signout(): void {

        this.redirectUrl = null;

        // Tells all the subscribers about the new status, data & roles.
        this.signinSubject.next(false);
        this.userSubject.next({});
        this.rolesSubject.next([]);

        // Unschedules the refresh token.
        this.unscheduleRefresh();

        // Revokes tokens.
        this.revokeToken();
        this.revokeRefreshToken();

    }

    /**
     * Checks if user is signed in.
     *
     * @return The user's status
     */
    public isSignedIn(): Observable<boolean> {

        return this.signinSubject.asObservable();

    }

    /**
     * Gets user's data.
     *
     * @return The user's data
     */
    public getUser(): Observable<any> {

        return this.userSubject.asObservable();

    }

    /**
     * Gets user's roles.
     *
     * @return The user's roles
     */
    public getRoles(): Observable<any> {

        return this.rolesSubject.asObservable();

    }

    /**
     * Checks for presence of token and that token hasn't expired.
     */
    private tokenNotExpired(): boolean {

        let token: string = Helpers.getToken('id_token');

        return token != null && (Helpers.getExp() > new Date().valueOf());

    }

    /**
     * Calls UserInfo endpoint to retrieve user's data.
     */
    private userInfo(): void {

        if (this.tokenNotExpired()) {
            this.authHttp.get(Config.USERINFO_ENDPOINT)
                .subscribe(
                (res: any) => {

                    let user: any = res.json();
                    let roles: string[] = user.role;

                    // Tells all the subscribers about the new data & roles.
                    this.userSubject.next(user);
                    this.rolesSubject.next(user.role);

                },
                (error: any) => {

                    // Need to handle this error.
                    console.log(error);

                });
        }

    }

    /**
     * Encodes the parameters.
     *
     * @param params The parameters to be encoded
     * @return The encoded parameters
     */
    private encodeParams(params: any): string {

        let body: string = "";
        for (let key in params) {
            if (body.length) {
                body += "&";
            }
            body += key + "=";
            body += encodeURIComponent(params[key]);
        }

        return body;
    }

    /**
     * Stores access token & refresh token.
     *
     * @param body The response of the request to the token endpoint
     */
    private store(body: any): void {

        // Stores access token to keep user signed in.
        Helpers.setToken('id_token', body.access_token);
        // Stores refresh token.
        Helpers.setToken('refresh_token', body.refresh_token);

        // Calculates token expiration.
        this.expiresIn = <number>body.expires_in * 1000; // To milliseconds.
        // Stores token expiration.
        Helpers.setExp(this.authTime + this.expiresIn);

    }

}

// Set Helpers to use the same storage in AppModule.
class Helpers {

    /**
     * Gets the token from the storage.
     *
     * @param name Token's name
     * @return The Token
     */
    public static getToken(name: string): string {

        return localStorage.getItem(name);

    }

    /**
     * Stores the token.
     *
     * @param name Token's name
     * @param value The token
     */
    public static setToken(name: string, value: string) {

        localStorage.setItem(name, value);

    }

    /**
     * Removes the token from the storage.
     *
     * @param name Token's name
     */
    public static removeToken(name: string): void {

        localStorage.removeItem(name);

    }

    /**
     * Stores token expiration.
     *
     * @param exp Token expiration in milliseconds
     */
    public static setExp(exp: number) {

        localStorage.setItem("exp", exp.toString());

    }

    /**
     * Gets token expiration.
     *
     * @return Token expiration in milliseconds
     */
    public static getExp(): number {

        return parseInt(localStorage.getItem("exp"));

    }

    /**
     * Removes token expiration from the storage.
     *
     * @return Token expiration in milliseconds
     */
    public static removeExp(): void {

        localStorage.removeItem("exp");

    }

}
